"""PostgreSQL queue claims, idempotency, and fenced output publication."""

import hashlib
import json
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import psycopg
from psycopg.types.json import Jsonb

from motion_dna_api.config import ROOT_ENV, Settings
from motion_dna_api.projects.repository import MAX_ACCOUNT_STORAGE

from .models import OutputMetadata, RenderJob, RenderRequest

LEASE_SECONDS = 30
RETRY_SECONDS = 5
CLAIM_LOCK = 703071


class RenderConflict(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)


class RenderQuotaExceeded(Exception):
    pass


@dataclass(frozen=True)
class Claim:
    job: RenderJob
    request: RenderRequest
    token: str


def input_hash(request: RenderRequest) -> str:
    payload = request.model_dump(mode="json", exclude={"idempotency_key"})
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


class Repository:
    def __init__(self, settings: Settings | str):
        self.dsn = (
            settings if isinstance(settings, str) else settings.database_url.get_secret_value()
        )
        self.storage = (
            ROOT_ENV.parent / "storage" / "renders"
            if isinstance(settings, str)
            else settings.render_storage_dir
        )
        self._ready = False
        self._guard = threading.Lock()

    def connect(self):
        connection = psycopg.connect(self.dsn, connect_timeout=3)
        try:
            connection.execute("SET statement_timeout = '5s'")
            if not self._ready:
                with self._guard:
                    connection.execute("SELECT pg_advisory_xact_lock(703070)")
                    connection.execute("""CREATE TABLE IF NOT EXISTS render_jobs (
                        id uuid PRIMARY KEY, project_id uuid NOT NULL, owner_id uuid,
                        idempotency_key text NOT NULL, input_hash text NOT NULL,
                        request jsonb NOT NULL, payload jsonb NOT NULL,
                        status text NOT NULL, attempt integer NOT NULL DEFAULT 0,
                        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
                        available_at timestamptz NOT NULL,
                        worker_id text, lease_token uuid, lease_expires timestamptz,
                        cancel_requested boolean NOT NULL DEFAULT false,
                        UNIQUE(project_id,idempotency_key)
                    )""")
                    connection.execute(
                        "ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS owner_id uuid"
                    )
                    connection.execute("""CREATE INDEX IF NOT EXISTS render_jobs_queue_idx
                        ON render_jobs(status,available_at,created_at)""")
                    connection.commit()
                    self._ready = True
            return connection
        except Exception:
            connection.close()
            raise

    def directory(self, identifier: UUID | str) -> Path:
        return self.storage / str(UUID(str(identifier)))

    @staticmethod
    def _write(connection, job: RenderJob):
        connection.execute(
            "UPDATE render_jobs SET payload=%s,status=%s,attempt=%s,updated_at=%s WHERE id=%s",
            (
                Jsonb(job.model_dump(mode="json", exclude_none=True)),
                job.status,
                job.attempt,
                job.updated_at,
                job.id,
            ),
        )

    def create(self, request: RenderRequest, owner_id: UUID) -> tuple[RenderJob, bool]:
        fingerprint = input_hash(request)
        now = datetime.now(UTC)
        with self.connect() as connection:
            project = connection.execute(
                "SELECT name FROM projects WHERE id=%s AND owner_id=%s AND deleted_at IS NULL",
                (request.project_id, owner_id),
            ).fetchone()
            if not project:
                raise RenderConflict("project_not_found", "Project not found for this account.")
            if "document" in request.input:
                for asset in request.input["document"].get("assets", []):
                    stored_id = asset.get("storageAssetId")
                    if (
                        stored_id
                        and not connection.execute(
                            "SELECT 1 FROM assets WHERE id=%s AND owner_id=%s AND project_id=%s",
                            (stored_id, owner_id, request.project_id),
                        ).fetchone()
                    ):
                        raise RenderConflict(
                            "invalid_assets",
                            "A project image is missing or belongs to another account.",
                        )
            request.project_name = project[0]
            fingerprint = input_hash(request)
            # This also makes the queue-cap check atomic with admission.
            connection.execute("SELECT pg_advisory_xact_lock(703073)")
            row = connection.execute(
                """SELECT payload,input_hash FROM render_jobs
                    WHERE project_id=%s AND owner_id=%s AND idempotency_key=%s FOR UPDATE""",
                (request.project_id, owner_id, request.idempotency_key),
            ).fetchone()
            if row:
                if row[1] != fingerprint:
                    raise RenderConflict(
                        "idempotency_conflict",
                        "This request key already belongs to a different export.",
                    )
                return RenderJob.model_validate(row[0]), True
            count = connection.execute(
                "SELECT count(*) FROM render_jobs WHERE owner_id=%s", (owner_id,)
            ).fetchone()[0]
            if count >= 100:
                raise RenderConflict(
                    "archive_full",
                    "The local render archive is full. Archive old exports before continuing.",
                )
            job = RenderJob(
                id=uuid4(),
                project_id=request.project_id,
                project_name=request.project_name,
                status="queued",
                stage="Queued locally",
                created_at=now,
                updated_at=now,
            )
            connection.execute(
                """INSERT INTO render_jobs
                    (id,project_id,owner_id,idempotency_key,input_hash,request,payload,status,created_at,updated_at,available_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    job.id,
                    request.project_id,
                    owner_id,
                    request.idempotency_key,
                    fingerprint,
                    Jsonb(request.model_dump(mode="json")),
                    Jsonb(job.model_dump(mode="json", exclude_none=True)),
                    job.status,
                    now,
                    now,
                    now,
                ),
            )
        return job, False

    def get(self, identifier: UUID, owner_id: UUID) -> RenderJob | None:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT r.payload,e.id FROM render_jobs r JOIN projects p
                    ON p.id=r.project_id AND p.owner_id=r.owner_id
                    LEFT JOIN exports e ON e.render_job_id=r.id AND e.owner_id=r.owner_id
                    WHERE r.id=%s AND r.owner_id=%s AND p.deleted_at IS NULL""",
                (identifier, owner_id),
            ).fetchone()
        if not row:
            return None
        job = RenderJob.model_validate(row[0])
        job.export_available = row[1] is not None
        if not job.export_available:
            job.download_url = None
        return job

    def list(self, owner_id: UUID) -> list[RenderJob]:
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT r.payload,e.id FROM render_jobs r JOIN projects p
                    ON p.id=r.project_id AND p.owner_id=r.owner_id
                    LEFT JOIN exports e ON e.render_job_id=r.id AND e.owner_id=r.owner_id
                    WHERE r.owner_id=%s AND p.deleted_at IS NULL
                    ORDER BY r.created_at DESC LIMIT 100""",
                (owner_id,),
            ).fetchall()
        jobs = []
        for row in rows:
            job = RenderJob.model_validate(row[0])
            job.export_available = row[1] is not None
            if not job.export_available:
                job.download_url = None
            jobs.append(job)
        return jobs

    def request_cancel(
        self, identifier: UUID, project_id: UUID, owner_id: UUID
    ) -> RenderJob | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT payload FROM render_jobs "
                "WHERE id=%s AND project_id=%s AND owner_id=%s FOR UPDATE",
                (identifier, project_id, owner_id),
            ).fetchone()
            if not row:
                return None
            job = RenderJob.model_validate(row[0])
            if job.status in {"completed", "failed", "cancelled"}:
                return job
            job.updated_at = datetime.now(UTC)
            job.status = "cancelling" if job.status in {"running", "cancelling"} else "cancelled"
            job.stage = (
                "Stopping renderer" if job.status == "cancelling" else "Cancelled before rendering"
            )
            self._write(connection, job)
            connection.execute(
                "UPDATE render_jobs SET cancel_requested=true WHERE id=%s", (job.id,)
            )
        return job

    def retry(self, identifier: UUID, project_id: UUID, owner_id: UUID) -> RenderJob | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT payload FROM render_jobs "
                "WHERE id=%s AND project_id=%s AND owner_id=%s FOR UPDATE",
                (identifier, project_id, owner_id),
            ).fetchone()
            if not row:
                return None
            job = RenderJob.model_validate(row[0])
            if job.status not in {"failed", "cancelled"} or job.attempt >= job.max_attempts:
                raise RenderConflict(
                    "retry_unavailable",
                    "This job cannot be retried again. Submit a new export instead.",
                )
            if job.error_code in {
                "invalid_input",
                "invalid_assets",
                "output_mismatch",
                "validation_failed",
            }:
                raise RenderConflict(
                    "permanent_failure", "Correct the project or assets and submit a new export."
                )
            job.status, job.progress, job.stage = "queued", 0, "Queued for retry"
            job.error = job.error_code = job.exit_code = None
            job.export_available, job.download_url = False, None
            job.updated_at = datetime.now(UTC)
            self._write(connection, job)
            connection.execute(
                """UPDATE render_jobs SET cancel_requested=false,available_at=now(),
                    lease_token=NULL,lease_expires=NULL,worker_id=NULL WHERE id=%s""",
                (job.id,),
            )
        return job

    def claim(self, worker_id: str) -> Claim | None:
        with self.connect() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (CLAIM_LOCK,))
            active = connection.execute(
                "SELECT 1 FROM render_jobs WHERE status IN ('running','cancelling') LIMIT 1"
            ).fetchone()
            if active:
                return None
            row = connection.execute(
                """SELECT payload,request FROM render_jobs
                    WHERE status IN ('queued','retrying') AND available_at<=now()
                    AND cancel_requested=false AND attempt<2
                    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"""
            ).fetchone()
            if not row:
                return None
            job, request = RenderJob.model_validate(row[0]), RenderRequest.model_validate(row[1])
            token, now = uuid4(), datetime.now(UTC)
            job.status, job.progress, job.stage = "running", 0, "Preparing composition"
            job.attempt += 1
            job.error = job.error_code = job.exit_code = None
            job.updated_at = now
            self._write(connection, job)
            connection.execute(
                "UPDATE render_jobs SET worker_id=%s,lease_token=%s,lease_expires=%s WHERE id=%s",
                (worker_id[:160], token, now + timedelta(seconds=LEASE_SECONDS), job.id),
            )
        return Claim(job, request, str(token))

    @staticmethod
    def _leased(connection, identifier, token):
        return connection.execute(
            """SELECT payload,cancel_requested,request FROM render_jobs WHERE id=%s
                AND lease_token=%s AND lease_expires>now()
                AND status IN ('running','cancelling') FOR UPDATE""",
            (identifier, token),
        ).fetchone()

    def heartbeat(self, identifier, token, progress=None, stage=None) -> bool:
        with self.connect() as connection:
            row = self._leased(connection, identifier, token)
            if not row:
                return False
            job = RenderJob.model_validate(row[0])
            job.updated_at = datetime.now(UTC)
            if progress is not None:
                job.progress = max(job.progress, min(99, max(0, float(progress))))
            if stage and not row[1]:
                job.stage = str(stage)[:100]
            self._write(connection, job)
            connection.execute(
                "UPDATE render_jobs SET lease_expires=%s WHERE id=%s",
                (job.updated_at + timedelta(seconds=LEASE_SECONDS), job.id),
            )
        return True

    def cancellation_requested(self, identifier, token) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT cancel_requested FROM render_jobs
                    WHERE id=%s AND lease_token=%s AND lease_expires>now()
                    AND status IN ('running','cancelling')""",
                (identifier, token),
            ).fetchone()
        return not row or bool(row[0])

    def finish(
        self, identifier, token, metadata: OutputMetadata, publish: Callable[[], None] | None = None
    ) -> bool:
        metadata = OutputMetadata.model_validate(metadata)
        with self.connect() as connection:
            row = self._leased(connection, identifier, token)
            if not row or row[1]:
                return False
            job, request = RenderJob.model_validate(row[0]), RenderRequest.model_validate(row[2])
            width, height = request.output.dimensions
            if (metadata.width, metadata.height, metadata.fps, metadata.frames) != (
                width,
                height,
                request.output.fps,
                request.expected_frames,
            ):
                raise ValueError("Rendered output does not match the requested settings.")
            if (
                abs(metadata.duration - request.expected_frames / request.output.fps)
                > 1 / request.output.fps
            ):
                raise ValueError("Rendered output duration does not match the frame budget.")
            ownership = connection.execute(
                "SELECT owner_id,project_id FROM render_jobs WHERE id=%s AND lease_token=%s",
                (job.id, token),
            ).fetchone()
            if ownership and metadata.bytes is not None:
                connection.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (ownership[0],))
                used = connection.execute(
                    "SELECT (SELECT coalesce(sum(byte_size),0) FROM assets WHERE owner_id=%s) "
                    "+ (SELECT coalesce(sum(byte_size),0) FROM exports WHERE owner_id=%s)",
                    (ownership[0], ownership[0]),
                ).fetchone()[0]
                if used + metadata.bytes > MAX_ACCOUNT_STORAGE:
                    raise RenderQuotaExceeded("The local account storage quota has been reached.")
            if publish:
                publish()
            job.status, job.progress, job.stage = "completed", 100, "MP4 ready"
            job.output, job.exit_code, job.updated_at = metadata, 0, datetime.now(UTC)
            job.download_url = f"/api/motion/render/{job.id}/download?project_id={job.project_id}"
            job.export_available = metadata.bytes is not None
            self._write(connection, job)
            if ownership and metadata.bytes is not None:
                connection.execute(
                    """INSERT INTO exports(id,owner_id,project_id,render_job_id,filename,
                        storage_key,byte_size,width,height,fps,duration)
                        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT(render_job_id) DO UPDATE SET byte_size=excluded.byte_size,
                        width=excluded.width,height=excluded.height,fps=excluded.fps,duration=excluded.duration""",
                    (
                        job.id,
                        ownership[0],
                        ownership[1],
                        job.id,
                        f"motion-dna-{job.id}.mp4",
                        f"renders/{job.id}/video.mp4",
                        metadata.bytes,
                        width,
                        height,
                        metadata.fps,
                        metadata.duration,
                    ),
                )
            connection.execute(
                "UPDATE render_jobs SET lease_token=NULL,lease_expires=NULL WHERE id=%s", (job.id,)
            )
        return True

    def download_path(
        self, identifier: UUID, owner_id: UUID, project_id: UUID
    ) -> tuple[RenderJob, Path] | None:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT r.payload,e.storage_key,e.byte_size FROM render_jobs r
                   JOIN projects p ON p.id=r.project_id AND p.owner_id=r.owner_id
                   JOIN exports e ON e.render_job_id=r.id AND e.owner_id=r.owner_id
                   WHERE r.id=%s AND r.owner_id=%s AND r.project_id=%s AND p.deleted_at IS NULL""",
                (identifier, owner_id, project_id),
            ).fetchone()
        if not row:
            return None
        job = RenderJob.model_validate(row[0])
        target = (self.storage.parent / row[1]).resolve()
        if (
            target.parent != self.storage.resolve() / str(identifier)
            or not target.is_file()
            or target.stat().st_size != row[2]
        ):
            return None
        return job, target

    def delete_export(self, identifier: UUID, project_id: UUID, owner_id: UUID) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """DELETE FROM exports e USING render_jobs r, projects p
                   WHERE e.render_job_id=r.id AND e.owner_id=r.owner_id
                   AND p.id=r.project_id AND p.owner_id=r.owner_id
                   AND r.id=%s AND r.project_id=%s AND r.owner_id=%s
                   AND p.deleted_at IS NULL RETURNING e.storage_key""",
                (identifier, project_id, owner_id),
            ).fetchone()
        if not row:
            return False
        target = (self.storage.parent / row[0]).resolve()
        if target.parent == (self.storage.resolve() / str(identifier)):
            target.unlink(missing_ok=True)
        return True

    def fail(self, identifier, token, error_code, error, retryable=False, exit_code=None) -> bool:
        with self.connect() as connection:
            row = self._leased(connection, identifier, token)
            if not row:
                return False
            job = RenderJob.model_validate(row[0])
            job.updated_at = datetime.now(UTC)
            job.exit_code = exit_code
            if row[1]:
                job.status, job.stage = "cancelled", "Render cancelled"
            else:
                job.error_code, job.error = str(error_code)[:80], str(error)[:300]
                job.status = (
                    "retrying" if retryable and job.attempt < job.max_attempts else "failed"
                )
                job.stage = (
                    "Waiting for bounded retry" if job.status == "retrying" else "Render failed"
                )
            self._write(connection, job)
            connection.execute(
                """UPDATE render_jobs SET available_at=%s,lease_token=NULL,
                    lease_expires=NULL,worker_id=NULL WHERE id=%s""",
                (job.updated_at + timedelta(seconds=RETRY_SECONDS), job.id),
            )
        return True

    def cancel_complete(self, identifier, token) -> bool:
        with self.connect() as connection:
            row = self._leased(connection, identifier, token)
            if not row:
                return False
            job = RenderJob.model_validate(row[0])
            job.status, job.stage, job.updated_at = (
                "cancelled",
                "Render cancelled",
                datetime.now(UTC),
            )
            self._write(connection, job)
            connection.execute(
                """UPDATE render_jobs SET cancel_requested=true,lease_token=NULL,
                    lease_expires=NULL,worker_id=NULL WHERE id=%s""",
                (job.id,),
            )
        return True

    def recover_expired(self) -> int:
        with self.connect() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (CLAIM_LOCK,))
            rows = connection.execute(
                """SELECT payload,cancel_requested FROM render_jobs
                    WHERE status IN ('running','cancelling') AND lease_expires<now()
                    FOR UPDATE"""
            ).fetchall()
            for row in rows:
                job = RenderJob.model_validate(row[0])
                job.updated_at = datetime.now(UTC)
                job.error_code, job.error = "worker_lost", "The render worker was interrupted."
                job.status = "cancelled" if row[1] else "retrying" if job.attempt < 2 else "failed"
                job.stage = "Render cancelled" if row[1] else "Recovering interrupted render"
                self._write(connection, job)
                connection.execute(
                    """UPDATE render_jobs SET available_at=%s,lease_token=NULL,
                        lease_expires=NULL,worker_id=NULL WHERE id=%s""",
                    (job.updated_at + timedelta(seconds=RETRY_SECONDS), job.id),
                )
        return len(rows)
