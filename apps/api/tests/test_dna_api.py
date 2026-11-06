import asyncio
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from motion_dna_api.auth.security import authenticated_user
from motion_dna_api.config import Settings
from motion_dna_api.dna import routes
from motion_dna_api.main import create_app


class MemoryRepository:
    def __init__(self):
        self.jobs = {}

    def create(self, job, owner_id, project_id):
        self.save(job)
        return True

    def save(self, job, *args):
        self.jobs[job.job_id] = job.model_copy()

    def get(self, identifier, owner_id):
        return self.jobs.get(identifier)

    def result(self, identifier, owner_id):
        return None

    def screenshot(self, identifier, owner_id):
        return None


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"url": "file:///etc/passwd"},
        {"url": "http://localhost"},
        {"url": "https://example.com", "project_id": str(uuid4()), "source": "code"},
        {"url": 12},
    ],
)
def test_invalid_input(payload):
    app = create_app(Settings(_env_file=None, app_env="test"))
    app.dependency_overrides[authenticated_user] = lambda: {"id": uuid4()}
    with TestClient(app) as client:
        assert client.post("/api/dna/analyze", json=payload).status_code == 422


def test_api_job_lifecycle_and_sanitized_failure(monkeypatch):
    app = create_app(Settings(_env_file=None, app_env="test"))
    repo = MemoryRepository()
    app.state.dna_repository = repo
    app.dependency_overrides[authenticated_user] = lambda: {"id": uuid4()}

    async def resolve(url):
        return "example.com", 443, ["93.184.216.34"]

    async def runner(*args):
        raise RuntimeError("private credentials must not be included")

    monkeypatch.setattr(routes, "resolve_public", resolve)
    monkeypatch.setattr(routes, "run_analysis", runner)
    with TestClient(app) as client:
        response = client.post(
            "/api/dna/analyze", json={"url": "https://example.com", "project_id": str(uuid4())}
        )
        assert response.status_code == 202
        identifier = response.json()["job_id"]
        for _ in range(20):
            job = client.get(f"/api/dna/jobs/{identifier}").json()
            if job["status"] == "failed":
                break
            client.portal.call(asyncio.sleep, 0.01)
        assert job["status"] == "failed"
        assert "credentials" not in str(job)
        assert client.get(f"/api/dna/results/{identifier}").status_code == 404
        assert client.get(f"/api/dna/jobs/{uuid4()}").status_code == 404
        assert client.get("/api/dna/jobs/not-an-id").status_code == 422
        assert (
            client.post(
                "/api/dna/analyze",
                json={"url": "https://example.com", "project_id": str(uuid4())},
                headers={"Origin": "https://evil.example"},
            ).status_code
            == 403
        )


def test_busy_admission_and_post_cors():
    app = create_app(Settings(_env_file=None, app_env="test"))
    app.state.dna_admitted = 2
    app.dependency_overrides[authenticated_user] = lambda: {"id": uuid4()}
    with TestClient(app) as client:
        response = client.post(
            "/api/dna/analyze", json={"url": "https://example.com", "project_id": str(uuid4())}
        )
        assert response.status_code == 429
        assert (
            client.options(
                "/api/dna/analyze",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "POST",
                },
            ).status_code
            == 200
        )


def test_api_rejects_oversized_body():
    app = create_app(Settings(_env_file=None, app_env="test"))
    app.dependency_overrides[authenticated_user] = lambda: {"id": uuid4()}
    with TestClient(app) as client:
        response = client.post("/api/dna/analyze", content=b"x" * 5000)
        assert response.status_code == 413
        assert response.json()["error"]["code"] == "request_too_large"
        assert response.headers["x-request-id"] == response.json()["error"]["request_id"]
