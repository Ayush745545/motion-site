"""Static source analysis tests: archives are parsed as data, never executed."""

import io
import json
import stat
import subprocess
import zipfile
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from motion_dna_api.auth.security import authenticated_user
from motion_dna_api.config import Settings
from motion_dna_api.main import create_app
from motion_dna_api.source.archive import SourceInputError, read_directory, read_zip
from motion_dna_api.source.github import parse_github_url
from motion_dna_api.source.models import SourceDNA
from motion_dna_api.source.service import analyze_files, analyze_zip

FIXTURE = Path(__file__).parent / "fixtures" / "source-next"


def fixture_zip() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(FIXTURE.rglob("*")):
            if path.is_file():
                archive.write(path, f"source-next/{path.relative_to(FIXTURE).as_posix()}")
    return output.getvalue()


def make_zip(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries:
            archive.writestr(name, data)
    return output.getvalue()


def test_next_fixture_produces_valid_grounded_signature_without_executing_scripts(monkeypatch):
    def never_execute(*args, **kwargs):
        raise AssertionError("source analysis must not invoke repository commands")

    monkeypatch.setattr(subprocess, "run", never_execute)
    result = analyze_zip(fixture_zip(), "atlas-product-studio")
    restored = SourceDNA.model_validate_json(result.model_dump_json())
    encoded = json.dumps(restored.model_dump(mode="json"))

    assert restored == result
    assert result.source_type == "zip"
    assert result.source_name == "Atlas Product Studio"
    assert {entry.name for entry in result.technology_fingerprint} >= {"Next.js", "React"}
    assert any(entry.name == "Tailwind CSS" for entry in result.styling_systems)
    assert any(entry.name == "GSAP" for entry in result.animation_libraries)
    assert {route.path for route in result.routes} >= {"/", "/studio", "/api/status"}
    assert {token.name for token in result.theme_tokens} >= {
        "--brand-accent",
        "--space-panel",
        "--font-display",
    }
    assert any(component.path == "components/Hero.tsx" for component in result.ui_components)
    assert any(
        asset.path == "public/brand-logo.svg" and not asset.available_for_render
        for asset in result.assets
    )
    assert [scene.id for scene in result.storyboard.scenes] == [
        "intro",
        "reveal",
        "features",
        "cta",
    ]
    assert result.storyboard.model == "static-rules-v1"
    assert "postinstall" not in encoded and "never run during" not in encoded
    assert "source-fixture-secret-never-return" not in encoded
    assert all("scripts" not in item.evidence for item in result.technology_fingerprint)


def test_source_changes_change_storyboard_claims_without_inventing_features():
    first = analyze_zip(fixture_zip(), "atlas-product-studio")
    changed_files = {
        "package.json": json.dumps(
            {"name": "garden-notes", "description": "A community garden planning journal."}
        ).encode(),
        "README.md": (
            b"# Garden Notes\n\nA shared journal for community garden plans and seasonal notes."
        ),
    }
    second = analyze_files(changed_files, "source_file", "garden-notes")
    assert first.storyboard.opening_hook != second.storyboard.opening_hook
    assert first.product_summary != second.product_summary
    assert "garden" in second.storyboard.opening_hook.lower()
    assert "checkout" not in second.model_dump_json().lower()


@pytest.mark.parametrize(
    "path",
    [
        "../escape.ts",
        "/absolute/file.ts",
        "C:/Windows/file.ts",
        "folder\\escape.ts",
        "folder/../../escape.ts",
    ],
)
def test_zip_path_traversal_and_platform_paths_are_rejected(path):
    with pytest.raises(SourceInputError, match="unsafe file path"):
        read_zip(make_zip([(path, b"export const x = 1;")]))


def test_zip_symlinks_duplicates_and_oversized_archives_are_rejected():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        link = zipfile.ZipInfo("project/link.ts")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(link, "../../secret.ts")
    with pytest.raises(SourceInputError, match="Symbolic links"):
        read_zip(output.getvalue())
    with pytest.raises(SourceInputError, match="20 MB"):
        read_zip(b"0" * (20 * 1024 * 1024 + 1))
    with pytest.raises(SourceInputError, match="duplicate"):
        read_zip(make_zip([("project/app.ts", b"a"), ("project/app.ts", b"b")]))


def test_zip_expansion_and_file_limits_are_enforced():
    with pytest.raises(SourceInputError, match="compression ratio"):
        read_zip(make_zip([("project/large.ts", b"a" * 600_000)]))
    with pytest.raises(SourceInputError, match="2 MB"):
        read_zip(make_zip([("project/large.ts", b"x" * (2 * 1024 * 1024 + 1))]))


def test_local_directory_mode_rejects_symlinks_and_reads_without_execution(tmp_path):
    project = tmp_path / "safe"
    project.mkdir()
    (project / "package.json").write_text(
        '{"name":"safe-project","scripts":{"build":"malicious command"}}'
    )
    (project / "README.md").write_text("# Safe Project\n\nA static source inspection fixture.")
    files, name = read_directory(project)
    result = analyze_files(files, "local_directory", name)
    assert result.source_type == "local_directory"
    assert result.source_name == "Safe Project"
    assert "malicious command" not in result.model_dump_json()
    outside = tmp_path / "outside.ts"
    outside.write_text("export const privateValue = 1")
    try:
        (project / "linked.ts").symlink_to(outside)
    except OSError:
        pytest.skip("This filesystem does not permit symlink creation.")
    with pytest.raises(SourceInputError, match="Symbolic links"):
        read_directory(project)


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/org/repo",
        "https://github.com.evil.test/org/repo",
        "https://user@github.com/org/repo",
        "https://github.com/org/repo/tree/main",
        "https://github.com/org/repo?token=secret",
        "https://github.com/../repo",
    ],
)
def test_only_root_public_https_github_urls_are_accepted(url):
    with pytest.raises(SourceInputError):
        parse_github_url(url)


def test_github_url_normalizes_git_suffix():
    assert parse_github_url("https://github.com/motion-dna/studio.git") == ("motion-dna", "studio")


def test_source_api_accepts_zip_and_mocked_public_github_and_validates_results():
    app = create_app(Settings(_env_file=None, app_env="test"))
    app.dependency_overrides[authenticated_user] = lambda: {"id": uuid4()}

    async def fake_github(url):
        assert url == "https://github.com/example/atlas"
        return fixture_zip(), "example/atlas"

    app.state.source_github_fetcher = fake_github
    with TestClient(app) as client:
        archive = client.post(
            "/api/source/analyze",
            content=fixture_zip(),
            headers={"Content-Type": "application/zip", "X-Source-Filename": "atlas.zip"},
        )
        assert archive.status_code == 200, archive.text
        SourceDNA.model_validate(archive.json())
        assert archive.json()["source_type"] == "zip"
        github = client.post(
            "/api/source/analyze",
            json={"github_url": "https://github.com/example/atlas"},
        )
        assert github.status_code == 200, github.text
        assert github.json()["source_type"] == "github"
        denied = client.post(
            "/api/source/analyze",
            json={"github_url": "https://github.com.evil.test/example/atlas"},
        )
        assert denied.status_code == 422
        assert (
            client.post(
                "/api/source/analyze", json={"source": "x", "source_name": ".env"}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/source/analyze",
                content=b"{}",
                headers={"Content-Type": "application/json", "Origin": "https://evil.test"},
            ).status_code
            == 403
        )


def test_github_route_rejects_invalid_request_without_fetching():
    app = create_app(Settings(_env_file=None, app_env="test"))
    app.dependency_overrides[authenticated_user] = lambda: {"id": uuid4()}
    app.state.source_github_fetcher = lambda _url: pytest.fail("invalid URL reached downloader")
    with TestClient(app) as client:
        response = client.post("/api/source/analyze", json={"github_url": "http://127.0.0.1:8000"})
    assert response.status_code == 422
