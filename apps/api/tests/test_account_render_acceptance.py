"""Slow local acceptance: an authenticated project produces a real MP4 export."""

import json
import os
import shutil
import subprocess
import time
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from motion_dna_api.config import Settings
from motion_dna_api.main import create_app

pytestmark = pytest.mark.skipif(
    os.environ.get("PROJECT_RENDER_TESTS") != "1",
    reason="Set PROJECT_RENDER_TESTS=1 with PostgreSQL and a local render worker running.",
)


def test_owned_project_can_be_saved_rendered_downloaded_and_deleted():
    settings = Settings()
    assert shutil.which("ffprobe"), "FFprobe is required to verify the rendered MP4."
    origin = settings.allowed_origins[0]
    user_id = project_id = job_id = None
    client = TestClient(create_app(settings))
    try:
        email = f"render-acceptance-{uuid4().hex}@example.test"
        registered = client.post(
            "/api/auth/register",
            headers={"Origin": origin},
            json={"email": email, "password": "render-acceptance-password"},
        )
        assert registered.status_code == 201, registered.text
        user_id = registered.json()["user"]["id"]

        document = {
            "name": "Account render acceptance",
            "sourceType": "url",
            "source": "https://example.com",
            "scenes": [
                {
                    "id": "opening",
                    "name": "Opening",
                    "headline": "A real local render",
                    "subline": "Saved inside a private account.",
                    "duration": 15,
                    "background": "#101216",
                    "foreground": "#F5F5F5",
                    "accent": "#2563EB",
                    "fontFamily": "sans",
                    "fontSize": 68,
                    "animation": "fade",
                    "align": "center",
                }
            ],
            "activeSceneId": "opening",
            "resolution": "1920x1080",
            "fps": 30,
        }
        created = client.post(
            "/api/projects", headers={"Origin": origin}, json={"document": document}
        )
        assert created.status_code == 201, created.text
        project = created.json()["project"]
        project_id = project["id"]
        document = project["document"]

        edited = {
            **document,
            "scenes": [{**document["scenes"][0], "headline": "Edited before export"}],
        }
        saved = client.put(
            f"/api/projects/{project_id}",
            headers={"Origin": origin},
            json={"revision": 1, "document": edited},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["project"]["revision"] == 2
        reopened = client.get(f"/api/projects/{project_id}")
        assert (
            reopened.json()["project"]["document"]["scenes"][0]["headline"]
            == "Edited before export"
        )

        render_request = {
            "project_id": project_id,
            "project_name": "Client supplied label",
            "idempotency_key": f"acceptance-{uuid4().hex}",
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
            "output": {"quality": "720p", "aspect_ratio": "16:9", "fps": 24},
        }
        submitted = client.post("/api/render/jobs", headers={"Origin": origin}, json=render_request)
        assert submitted.status_code == 202, submitted.text
        job_id = submitted.json()["id"]

        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            response = client.get(f"/api/render/jobs/{job_id}")
            assert response.status_code == 200, response.text
            job = response.json()
            if job["status"] in {"completed", "failed", "cancelled"}:
                break
            time.sleep(2)
        else:
            raise TimeoutError("The render worker did not finish within ten minutes.")

        assert job["status"] == "completed", job
        assert job["output"] == {
            "width": 1280,
            "height": 720,
            "fps": 24,
            "duration": 15,
            "frames": 360,
            "codec": "h264",
            "bytes": job["output"]["bytes"],
        }
        assert job["output"]["bytes"] > 0
        output_path = settings.render_storage_dir / job_id / "video.mp4"
        assert output_path.is_file() and output_path.stat().st_size > 0
        probe = json.loads(
            subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-count_frames",
                    "-show_entries",
                    "stream=codec_name,width,height,r_frame_rate,nb_read_frames",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "json",
                    str(output_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            ).stdout
        )
        stream = probe["streams"][0]
        assert (
            stream["codec_name"],
            stream["width"],
            stream["height"],
            stream["r_frame_rate"],
            int(stream["nb_read_frames"]),
        ) == ("h264", 1280, 720, "24/1", 360)
        assert abs(float(probe["format"]["duration"]) - 15) < 0.05

        download = client.get(
            f"/api/render/jobs/{job_id}/download", params={"project_id": project_id}
        )
        assert download.status_code == 200
        assert download.headers["content-type"].startswith("video/mp4")
        assert b"ftyp" in download.content[:32]
        deleted = client.delete(f"/api/projects/{project_id}", headers={"Origin": origin})
        assert deleted.status_code == 202
        assert client.get(f"/api/projects/{project_id}").status_code == 404
        assert (
            client.get(
                f"/api/render/jobs/{job_id}/download", params={"project_id": project_id}
            ).status_code
            == 404
        )
    finally:
        if job_id and project_id:
            current = client.get(f"/api/render/jobs/{job_id}")
            if current.status_code == 200 and current.json()["status"] in {
                "queued",
                "retrying",
                "running",
                "cancelling",
            }:
                client.post(
                    f"/api/render/jobs/{job_id}/cancel",
                    headers={"Origin": origin},
                    json={"project_id": project_id},
                )
                deadline = time.monotonic() + 45
                while time.monotonic() < deadline:
                    current = client.get(f"/api/render/jobs/{job_id}")
                    if current.status_code != 200 or current.json()["status"] in {
                        "cancelled",
                        "failed",
                        "completed",
                    }:
                        break
                    time.sleep(1)
        if user_id:
            with psycopg.connect(settings.database_url.get_secret_value()) as connection:
                connection.execute("DELETE FROM users WHERE id=%s", (user_id,))
        if job_id:
            shutil.rmtree(settings.render_storage_dir / job_id, ignore_errors=True)
        client.close()
