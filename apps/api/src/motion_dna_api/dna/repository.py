"""Durable jobs/results in PostgreSQL, with bounded retention and atomic completion."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from .models import DNAResult, Job


class Repository:
    def __init__(self, dsn):
        self.dsn = dsn

    def connect(self):
        connection = psycopg.connect(self.dsn, connect_timeout=3)
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET statement_timeout = '5s'")
                cursor.execute("SELECT pg_advisory_xact_lock(703031)")
                cursor.execute("""CREATE TABLE IF NOT EXISTS dna_jobs (
                    id uuid PRIMARY KEY, owner_id uuid, project_id uuid,
                    created_at timestamptz NOT NULL,
                    payload jsonb NOT NULL, result jsonb, screenshot bytea
                )""")
                cursor.execute("ALTER TABLE dna_jobs ADD COLUMN IF NOT EXISTS owner_id uuid")
                cursor.execute("ALTER TABLE dna_jobs ADD COLUMN IF NOT EXISTS project_id uuid")
            connection.commit()
            return connection
        except Exception:
            connection.close()
            raise

    def create(self, job: Job, owner_id: UUID, project_id: UUID) -> bool:
        with self.connect() as connection:
            project = connection.execute(
                "SELECT 1 FROM projects WHERE id=%s AND owner_id=%s AND deleted_at IS NULL",
                (project_id, owner_id),
            ).fetchone()
            if not project:
                return False
            # Keep the most recent 100 completed captures (at most ~200 MB screenshots).
            connection.execute(
                """DELETE FROM dna_jobs WHERE id IN (
                SELECT id FROM dna_jobs WHERE owner_id=%s
                AND payload->>'status' IN ('completed','failed')
                ORDER BY created_at DESC OFFSET 99) AND owner_id=%s""",
                (owner_id, owner_id),
            )
            connection.execute(
                "INSERT INTO dna_jobs (id,owner_id,project_id,created_at,payload) "
                "VALUES (%s,%s,%s,%s,%s)",
                (
                    job.job_id,
                    owner_id,
                    project_id,
                    job.created_at,
                    Jsonb(job.model_dump(mode="json")),
                ),
            )
        return True

    def save(
        self,
        job: Job,
        owner_id: UUID,
        project_id: UUID,
        result: DNAResult | None = None,
        screenshot: bytes | None = None,
    ):
        with self.connect() as connection:
            saved = connection.execute(
                "UPDATE dna_jobs SET payload=%s, result=%s, screenshot=%s "
                "WHERE id=%s AND owner_id=%s AND project_id=%s "
                "AND EXISTS (SELECT 1 FROM projects p WHERE p.id=dna_jobs.project_id "
                "AND p.owner_id=dna_jobs.owner_id AND p.deleted_at IS NULL)",
                (
                    Jsonb(job.model_dump(mode="json")),
                    Jsonb(result.model_dump(mode="json")) if result else None,
                    screenshot,
                    job.job_id,
                    owner_id,
                    project_id,
                ),
            ).rowcount
            if result and saved:
                connection.execute(
                    """INSERT INTO dna_analyses(id,owner_id,project_id,schema_version,result)
                    VALUES(%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET result=excluded.result""",
                    (
                        result.analysis_id,
                        owner_id,
                        project_id,
                        result.schema_version,
                        Jsonb(result.model_dump(mode="json")),
                    ),
                )

    def get(self, identifier: UUID, owner_id: UUID):
        with self.connect() as connection:
            row = connection.execute(
                """SELECT d.payload,d.project_id FROM dna_jobs d JOIN projects p
                   ON p.id=d.project_id AND p.owner_id=d.owner_id
                   WHERE d.id=%s AND d.owner_id=%s AND p.deleted_at IS NULL""",
                (identifier, owner_id),
            ).fetchone()
        if not row:
            return None
        job = Job.model_validate(row[0])
        if job.status in {"queued", "running"} and job.created_at < datetime.now(UTC) - timedelta(
            minutes=2
        ):
            job.status, job.error_code, job.error = (
                "failed",
                "interrupted",
                "The analyzer was interrupted. Retry the analysis.",
            )
            self.save(job, owner_id, row[1])
        return job

    def result(self, identifier: UUID, owner_id: UUID):
        with self.connect() as connection:
            row = connection.execute(
                """SELECT d.result FROM dna_jobs d JOIN projects p
                   ON p.id=d.project_id AND p.owner_id=d.owner_id
                   WHERE d.id=%s AND d.owner_id=%s AND p.deleted_at IS NULL""",
                (identifier, owner_id),
            ).fetchone()
        return DNAResult.model_validate(row[0]) if row and row[0] else None

    def screenshot(self, identifier: UUID, owner_id: UUID):
        with self.connect() as connection:
            row = connection.execute(
                """SELECT d.screenshot FROM dna_jobs d JOIN projects p
                   ON p.id=d.project_id AND p.owner_id=d.owner_id
                   WHERE d.id=%s AND d.owner_id=%s AND p.deleted_at IS NULL""",
                (identifier, owner_id),
            ).fetchone()
        return bytes(row[0]) if row and row[0] else None
