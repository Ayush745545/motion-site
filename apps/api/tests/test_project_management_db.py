"""PostgreSQL acceptance checks for account, revision, asset and render ownership."""

import os
import struct
import zlib
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from motion_dna_api.config import Settings
from motion_dna_api.database import apply_migrations
from motion_dna_api.main import create_app

pytestmark = pytest.mark.skipif(
    os.environ.get("PROJECT_DATABASE_TESTS") != "1",
    reason="Set PROJECT_DATABASE_TESTS=1 to exercise account storage in local PostgreSQL.",
)


def project_document(name: str) -> dict:
    scene = {
        "id": "opening",
        "name": "Opening",
        "headline": name,
        "subline": "Your story starts here.",
        "duration": 4,
        "background": "#101216",
        "foreground": "#F5F5F5",
        "accent": "#2563EB",
        "fontFamily": "sans",
        "fontSize": 68,
        "animation": "fade",
        "align": "center",
    }
    return {
        "id": "client-supplied-id-is-ignored",
        "name": name,
        "sourceType": "url",
        "source": "https://example.com",
        "createdAt": "2026-11-04T00:00:00+00:00",
        "updatedAt": "2026-11-04T00:00:00+00:00",
        "resolution": "1920x1080",
        "fps": 30,
        "scenes": [scene],
        "activeSceneId": "opening",
    }


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    body = kind + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))


def png_fixture() -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(b"\0\0\0\0\0"))
        + png_chunk(b"IEND", b"")
    )


def render_request(project_id: str) -> dict:
    return {
        "project_id": project_id,
        "project_name": "Client supplied project title",
        "idempotency_key": f"database-test-{uuid4()}",
        "input": {
            "document": {
                "schemaVersion": "1.0",
                "composition": {"width": 1280, "height": 720, "fps": 30},
                "scenes": [
                    {
                        "id": "render-scene",
                        "name": "Opening",
                        "durationInFrames": 450,
                        "background": "#101216",
                        "transition": {"preset": "cut", "durationInFrames": 0},
                    }
                ],
                "layers": [],
                "assets": [],
                "export": {"codec": "h264", "crf": 18, "pixelFormat": "yuv420p"},
            }
        },
        "output": {"quality": "720p", "aspect_ratio": "16:9", "fps": 30},
    }


def test_local_account_projects_versions_assets_and_render_jobs_are_owner_scoped(tmp_path):
    base = Settings()
    settings = base.model_copy(
        update={"app_env": "test", "render_storage_dir": tmp_path / "renders"}
    )
    apply_migrations(settings)
    app = create_app(settings)
    origin = {"Origin": "http://localhost:3000"}
    password = "local-passphrase-123"
    email_a = f"owner-a-{uuid4()}@example.test"
    email_b = f"owner-b-{uuid4()}@example.test"
    user_ids: list[str] = []
    try:
        with TestClient(app) as owner_a, TestClient(app) as owner_b:
            created_account_a = owner_a.post(
                "/api/auth/register", headers=origin, json={"email": email_a, "password": password}
            )
            created_account_b = owner_b.post(
                "/api/auth/register", headers=origin, json={"email": email_b, "password": password}
            )
            assert created_account_a.status_code == 201, created_account_a.text
            assert created_account_b.status_code == 201, created_account_b.text
            user_ids.extend(
                [created_account_a.json()["user"]["id"], created_account_b.json()["user"]["id"]]
            )
            assert "httponly" in created_account_a.headers["set-cookie"].lower()
            assert owner_a.get("/api/auth/session").json()["user"]["email"] == email_a

            created = owner_a.post(
                "/api/projects", headers=origin, json={"document": project_document("Original")}
            )
            assert created.status_code == 201, created.text
            record = created.json()["project"]
            project_id = record["id"]
            assert project_id != "client-supplied-id-is-ignored"
            assert record["revision"] == 1

            updated_document = {**record["document"], "name": "Saved revision two"}
            updated = owner_a.put(
                f"/api/projects/{project_id}",
                headers=origin,
                json={"revision": 1, "document": updated_document},
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["project"]["revision"] == 2
            assert (
                owner_a.get(f"/api/projects/{project_id}").json()["project"]["document"]["name"]
                == "Saved revision two"
            )
            versions = owner_a.get(f"/api/projects/{project_id}/versions").json()["versions"]
            assert [version["revision"] for version in versions] == [2, 1]
            first_version = owner_a.get(f"/api/projects/{project_id}/versions/1").json()["version"]
            assert first_version["document"]["name"] == "Original"

            # This PNG has a real 1x1 IHDR and stays outside the public web root.
            image = png_fixture()
            uploaded = owner_a.post(
                f"/api/projects/{project_id}/assets",
                headers={**origin, "Content-Type": "image/png", "X-File-Name": "private.png"},
                content=image,
            )
            assert uploaded.status_code == 201, uploaded.text
            asset_id = uploaded.json()["asset"]["id"]
            assert owner_a.get(f"/api/projects/{project_id}/assets/{asset_id}").content == image
            assert owner_b.get(f"/api/projects/{project_id}").status_code == 404
            assert owner_b.get(f"/api/projects/{project_id}/assets/{asset_id}").status_code == 404
            assert (
                owner_b.put(
                    f"/api/projects/{project_id}",
                    headers=origin,
                    json={"revision": 2, "document": updated_document},
                ).status_code
                == 404
            )
            assert owner_b.delete(f"/api/projects/{project_id}", headers=origin).status_code == 404
            assert owner_b.get("/api/projects").json()["projects"] == []

            job = owner_a.post("/api/render/jobs", headers=origin, json=render_request(project_id))
            assert job.status_code == 202, job.text
            job_id = job.json()["id"]
            # Exercise only private download authorization with a tiny fixture file;
            # rendering itself remains covered by the real Remotion acceptance tests.
            output = settings.render_storage_dir / job_id / "video.mp4"
            output.parent.mkdir(parents=True)
            fixture_bytes = b"private-export-fixture"
            output.write_bytes(fixture_bytes)
            with psycopg.connect(settings.database_url.get_secret_value()) as connection:
                connection.execute(
                    "UPDATE render_jobs SET payload=jsonb_set(jsonb_set(payload,'{status}',"
                    "'\"completed\"'::jsonb),'{output}',%s) WHERE id=%s",
                    (
                        Jsonb(
                            {
                                "width": 1280,
                                "height": 720,
                                "fps": 30,
                                "duration": 15,
                                "frames": 450,
                                "codec": "h264",
                                "bytes": len(fixture_bytes),
                            }
                        ),
                        UUID(job_id),
                    ),
                )
                connection.execute(
                    """INSERT INTO exports(id,owner_id,project_id,render_job_id,filename,
                       storage_key,byte_size,width,height,fps,duration)
                       VALUES(%s,%s,%s,%s,%s,%s,%s,1280,720,30,15)""",
                    (
                        uuid4(),
                        UUID(user_ids[0]),
                        UUID(project_id),
                        UUID(job_id),
                        "private.mp4",
                        f"renders/{job_id}/video.mp4",
                        len(fixture_bytes),
                    ),
                )
            download_url = f"/api/render/jobs/{job_id}/download?project_id={project_id}"
            assert owner_a.get(download_url).content == fixture_bytes
            assert owner_a.get("/api/account/usage").json()["used_bytes"] == len(image) + len(
                fixture_bytes
            )
            assert owner_b.get(f"/api/render/jobs/{job_id}").status_code == 404
            assert owner_b.get(download_url).status_code == 404
            export_url = f"/api/render/jobs/{job_id}/export?project_id={project_id}"
            assert owner_b.delete(export_url, headers=origin).status_code == 404
            removed = owner_a.delete(export_url, headers=origin)
            assert removed.status_code == 200, removed.text
            assert not output.exists()
            stored_job = owner_a.get(f"/api/render/jobs/{job_id}").json()
            assert stored_job["export_available"] is False
            assert owner_a.get(download_url).status_code == 404
            assert owner_a.get("/api/account/usage").json()["used_bytes"] == len(image)
            assert (
                owner_b.post(
                    "/api/render/jobs", headers=origin, json=render_request(project_id)
                ).status_code
                == 404
            )

            deleted = owner_a.delete(f"/api/projects/{project_id}", headers=origin)
            assert deleted.status_code == 202
            assert deleted.json()["purge_after_days"] == 30
            assert owner_a.get(f"/api/projects/{project_id}").status_code == 404
            assert owner_a.get(f"/api/projects/{project_id}/assets/{asset_id}").status_code == 404
            assert owner_a.get(f"/api/render/jobs/{job_id}").status_code == 404
    finally:
        if user_ids:
            with psycopg.connect(settings.database_url.get_secret_value()) as connection:
                connection.execute("DELETE FROM users WHERE id = ANY(%s::uuid[])", (user_ids,))
