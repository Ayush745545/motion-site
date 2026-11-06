"""Render request, HTTP boundary, and worker outcome tests."""

import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from motion_dna_api.auth.security import authenticated_user, password_hash
from motion_dna_api.config import Settings
from motion_dna_api.main import create_app
from motion_dna_api.renders import worker as worker_module
from motion_dna_api.renders.models import OutputMetadata, RenderJob, RenderRequest
from motion_dna_api.renders.repository import RenderConflict, Repository
from motion_dna_api.renders.worker import RenderCancelled, RenderWorker

PROJECT_ID = UUID("70000000-0000-4000-8000-000000000007")
JOB_ID = UUID("70000000-0000-4000-8000-000000000008")
OTHER_PROJECT_ID = UUID("70000000-0000-4000-8000-000000000009")


def request_data(**overrides):
    value = {
        "project_id": str(PROJECT_ID),
        "project_name": "Render fixture",
        "idempotency_key": "test-render-key-0001",
        "input": {
            "document": {
                "schemaVersion": "1.0",
                "composition": {"width": 1280, "height": 720, "fps": 30},
                "scenes": [
                    {
                        "id": "scene-one",
                        "name": "Opening",
                        "durationInFrames": 450,
                        "background": "#101010",
                        "transition": {"preset": "cut", "durationInFrames": 0},
                    }
                ],
                "layers": [],
                "assets": [],
                "export": {"codec": "h264", "crf": 18, "pixelFormat": "yuv420p"},
            }
        },
        "output": {"quality": "720p", "aspect_ratio": "9:16", "fps": 24},
    }
    value.update(overrides)
    return value


def make_job(status="queued", project_id=PROJECT_ID, attempt=0):
    now = datetime.now(UTC)
    return RenderJob(
        id=JOB_ID,
        project_id=project_id,
        project_name="Render fixture",
        status=status,
        progress=0,
        stage="Queued locally",
        created_at=now,
        updated_at=now,
        attempt=attempt,
    )


class MemoryRepository:
    """Small route/worker boundary fake; production persistence stays in PostgreSQL."""

    def __init__(self, storage: Path | None = None):
        self.storage = storage or Path("/tmp/motion-dna-test-renders")
        self.job = make_job()
        self.request = RenderRequest.model_validate(request_data())
        self.events = []
        self.owner_id = None

    def create(self, request, owner_id):
        self.owner_id = owner_id
        return self.job, False

    def list(self, owner_id):
        return [self.job]

    def get(self, identifier, owner_id):
        if identifier != self.job.id or owner_id != self.owner_id:
            return None
        return self.job

    def request_cancel(self, identifier, project_id, owner_id):
        if self.get(identifier, owner_id) is None:
            return None
        self.job.status = "cancelled"
        return self.job

    def retry(self, identifier, project_id, owner_id):
        if self.get(identifier, owner_id) is None:
            return None
        self.job.status = "queued"
        return self.job

    def directory(self, identifier):
        return self.storage / str(identifier)

    def claim(self, worker_id):
        return None

    def cancellation_requested(self, identifier, token):
        return False

    def heartbeat(self, identifier, token, progress=None, stage=None):
        self.events.append(("heartbeat", progress, stage))
        return True

    def finish(self, identifier, token, metadata, publish=None):
        if publish:
            publish()
        self.events.append(("finished", metadata))
        return True

    def fail(self, identifier, token, code, message, retryable=False, exit_code=None):
        self.events.append(("failed", code, retryable, exit_code))
        return True

    def cancel_complete(self, identifier, token):
        self.events.append(("cancelled",))
        return True


def test_request_dimensions_duration_and_strict_validation():
    request = RenderRequest.model_validate(request_data())
    assert request.output.dimensions == (720, 1280)
    assert request.expected_frames == 360
    assert request.duration_seconds == 15

    invalid = request_data()
    invalid["output"]["fps"] = 25
    with pytest.raises(ValueError):
        RenderRequest.model_validate(invalid)

    invalid = request_data()
    invalid["input"]["document"]["scenes"][0]["durationInFrames"] = 0
    with pytest.raises(ValueError):
        RenderRequest.model_validate(invalid)


def test_render_routes_enforce_origin_and_project_scope():
    app = create_app(Settings(_env_file=None, app_env="test"))
    repository = MemoryRepository()
    app.state.render_repository = repository
    owner_id = uuid4()
    app.dependency_overrides[authenticated_user] = lambda: {"id": owner_id}
    client = TestClient(app)

    denied = client.post(
        "/api/render/jobs",
        json=request_data(),
        headers={"Origin": "https://untrusted.example"},
    )
    assert denied.status_code == 403

    created = client.post("/api/render/jobs", json=request_data())
    assert created.status_code == 202
    assert created.json()["project_id"] == str(PROJECT_ID)

    app.dependency_overrides[authenticated_user] = lambda: {"id": uuid4()}
    hidden = client.get(f"/api/render/jobs/{JOB_ID}")
    assert hidden.status_code == 404
    cancelled = client.post(
        f"/api/render/jobs/{JOB_ID}/cancel", json={"project_id": str(PROJECT_ID)}
    )
    assert cancelled.status_code == 404


class FakeProcess:
    pid = 2_147_483_647
    stdout = None

    def __init__(self, returncode=0):
        self.returncode = returncode

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        return self.returncode


def run_worker_case(monkeypatch, tmp_path, *, returncode=1, cancel=False):
    repository = MemoryRepository(tmp_path / "renders")
    repository.job = make_job(status="running", attempt=1)
    request = repository.request
    worker = RenderWorker(repository, tmp_path, node="node", ffprobe="ffprobe")
    process = FakeProcess(returncode)
    monkeypatch.setattr(worker_module.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(worker_module, "stop_process", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        worker,
        "supervise",
        lambda process, job, token, log: (
            (_ for _ in ()).throw(RenderCancelled()) if cancel else None
        ),
    )
    worker.run_claim(
        type(
            "ClaimFixture",
            (),
            {"job": repository.job, "request": request, "token": "fixture-token"},
        )()
    )
    return repository


def test_worker_records_renderer_exit_and_bounded_retry(monkeypatch, tmp_path):
    repository = run_worker_case(monkeypatch, tmp_path, returncode=17)
    assert ("failed", "renderer_exit", True, 17) in repository.events
    log = repository.directory(JOB_ID) / "attempt-1.log"
    assert log.is_file()


def test_worker_cancellation_stops_the_active_attempt(monkeypatch, tmp_path):
    repository = run_worker_case(monkeypatch, tmp_path, cancel=True)
    assert ("cancelled",) in repository.events
    assert not (repository.directory(JOB_ID) / "video.mp4").exists()


def test_output_metadata_rejects_invalid_dimensions():
    with pytest.raises(ValueError):
        OutputMetadata(width=8000, height=720, fps=24, frames=360, duration=15, codec="h264")


@pytest.mark.skipif(
    os.environ.get("RENDER_DATABASE_TESTS") != "1",
    reason="Set RENDER_DATABASE_TESTS=1 to exercise the local PostgreSQL render queue.",
)
def test_postgres_queue_is_idempotent_fenced_and_project_scoped():
    repository = Repository(Settings())
    project_id = uuid4()
    owner_id = uuid4()
    key = f"integration-{uuid4().hex}"
    document = {
        "name": "Render queue integration",
        "sourceType": "url",
        "source": "https://example.com",
        "scenes": [{"id": "only-scene", "name": "Opening", "duration": 15}],
        "activeSceneId": "only-scene",
        "resolution": "1920x1080",
        "fps": 30,
    }
    with repository.connect() as connection:
        connection.execute(
            "INSERT INTO users(id,email,password_hash) VALUES(%s,%s,%s)",
            (
                owner_id,
                f"render-test-{owner_id}@example.test",
                password_hash("test-password-is-long-enough"),
            ),
        )
        connection.execute(
            "INSERT INTO projects(id,owner_id,name,schema_version,revision,document) "
            "VALUES(%s,%s,%s,1,1,%s)",
            (project_id, owner_id, document["name"], Jsonb(document)),
        )
    request = RenderRequest.model_validate(
        request_data(project_id=str(project_id), idempotency_key=key)
    )
    try:
        created, replayed = repository.create(request, owner_id)
        duplicate, duplicate_replayed = repository.create(request, owner_id)
        assert not replayed and duplicate_replayed
        assert duplicate.id == created.id

        changed_document = dict(request.input["document"])
        changed_document["scenes"] = [
            {**request.input["document"]["scenes"][0], "name": "Changed scene content"}
        ]
        changed = request.model_copy(update={"input": {"document": changed_document}})
        with pytest.raises(RenderConflict, match="different export"):
            repository.create(changed, owner_id)

        assert repository.get(created.id, owner_id) is not None
        assert repository.get(created.id, uuid4()) is None
        claim = repository.claim("render-queue-integration-test")
        assert claim is not None and claim.job.id == created.id and claim.job.attempt == 1
        assert repository.claim("second-worker-must-not-overlap") is None

        cancelling = repository.request_cancel(created.id, project_id, owner_id)
        assert cancelling is not None and cancelling.status == "cancelling"
        assert repository.cancellation_requested(created.id, claim.token)
        assert repository.cancel_complete(created.id, claim.token)
        completed = repository.get(created.id, owner_id)
        assert completed is not None and completed.status == "cancelled"

        retried = repository.retry(created.id, project_id, owner_id)
        assert retried is not None and retried.status == "queued"
        second_claim = repository.claim("render-queue-integration-test")
        assert second_claim is not None and second_claim.job.attempt == 2
        assert repository.fail(
            created.id,
            second_claim.token,
            "renderer_exit",
            "Renderer exited with code 17",
            retryable=True,
            exit_code=17,
        )
        failed = repository.get(created.id, owner_id)
        assert failed is not None and failed.status == "failed" and failed.exit_code == 17
        with pytest.raises(RenderConflict, match="cannot be retried again"):
            repository.retry(created.id, project_id, owner_id)
    finally:
        with repository.connect() as connection:
            connection.execute("DELETE FROM users WHERE id=%s", (owner_id,))
            connection.execute("DELETE FROM projects WHERE id=%s", (project_id,))
