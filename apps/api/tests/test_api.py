import json
import logging

import pytest
from fastapi import Query
from fastapi.testclient import TestClient
from pydantic import ValidationError

from motion_dna_api.config import ROOT_ENV, Settings
from motion_dna_api.database import get_database_probe
from motion_dna_api.logging import JsonFormatter
from motion_dna_api.main import create_app


@pytest.fixture
def app():
    return create_app(Settings(_env_file=None, app_env="test"))


def test_health_matches_contract_and_has_request_id(app):
    with TestClient(app) as client:
        response = client.get("/api/health", headers={"X-Request-ID": "test-request-123"})
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "motion-dna-ai-api",
        "version": "0.1.0",
        "environment": "test",
    }
    assert response.headers["x-request-id"] == "test-request-123"


def test_invalid_request_id_is_replaced(app):
    with TestClient(app) as client:
        response = client.get("/api/health", headers={"X-Request-ID": "unsafe id!"})
    request_id = response.headers["x-request-id"]
    assert len(request_id) == 32
    assert request_id != "unsafe id!"


@pytest.mark.parametrize("origin", ["http://localhost:3000", "http://127.0.0.1:3000"])
def test_cors_allows_explicit_origin(app, origin):
    with TestClient(app) as client:
        response = client.get("/api/health", headers={"Origin": origin})
        preflight = client.options(
            "/api/health",
            headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
        )
    assert response.headers["access-control-allow-origin"] == origin
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin


def test_cors_does_not_allow_unknown_origins(app):
    with TestClient(app) as client:
        response = client.get("/api/health", headers={"Origin": "https://untrusted.example"})
        preflight = client.options(
            "/api/health",
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert "access-control-allow-origin" not in response.headers
    assert preflight.status_code == 400


@pytest.mark.parametrize(
    "origins",
    [[], ["*"], ["https://*.example.com"], ["http://localhost:3000/path"], ["file://localhost"]],
)
def test_settings_reject_non_origin_cors_entries(origins):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, allowed_origins=origins)


@pytest.mark.parametrize(
    "settings", [{"api_port": 0}, {"app_env": "unknown"}, {"database_url": "sqlite:///local.db"}]
)
def test_settings_reject_invalid_values(settings):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **settings)


def test_settings_hide_database_credentials():
    settings = Settings(_env_file=None, database_url="postgresql://user:secret@localhost/db")
    assert "secret" not in repr(settings)
    assert ROOT_ENV.name == ".env"
    assert (ROOT_ENV.parent / "apps" / "api" / "pyproject.toml").is_file()


def test_settings_read_explicit_origins_from_environment(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", '["http://localhost:4321"]')
    assert Settings(_env_file=None).allowed_origins == ["http://localhost:4321"]


def test_readiness_uses_injected_database_probe(app):
    app.dependency_overrides[get_database_probe] = lambda: lambda: True
    with TestClient(app) as client:
        response = client.get("/api/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "connected"}


@pytest.mark.parametrize("raises", [False, True])
def test_readiness_reports_database_failure_without_secrets(app, raises):
    def probe():
        if raises:
            raise RuntimeError("postgresql://user:secret@localhost/db")
        return False

    app.dependency_overrides[get_database_probe] = lambda: probe
    with TestClient(app) as client:
        response = client.get("/api/ready")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]
    assert "secret" not in response.text


def test_missing_route_returns_structured_error(app):
    with TestClient(app) as client:
        response = client.get("/not-found")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]


def test_validation_error_omits_input(app):
    @app.get("/test-validation")
    def validation_endpoint(value: int = Query()):
        return {"value": value}

    with TestClient(app) as client:
        response = client.get("/test-validation", params={"value": "secret-input"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert response.json()["error"]["details"] == [
        {"location": ["query", "value"], "code": "int_parsing"}
    ]
    assert "secret-input" not in response.text


def test_unhandled_error_is_sanitized_and_has_cors(app):
    @app.get("/test-error")
    def error_endpoint():
        raise RuntimeError("a secret that must not be returned")

    with TestClient(app) as client:
        response = client.get("/test-error", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]
    assert "secret" not in response.text


def test_json_formatter_produces_structured_log():
    record = logging.LogRecord("motion_dna_api", logging.INFO, "", 0, "request_completed", (), None)
    record.request_id = "unit-request-id"
    record.status_code = 200
    payload = json.loads(JsonFormatter().format(record))
    assert payload["event"] == "request_completed"
    assert payload["request_id"] == "unit-request-id"
    assert payload["status_code"] == 200
    assert payload["level"] == "info"
    assert "timestamp" in payload
