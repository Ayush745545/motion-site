"""Real local HTTP fixtures. The test-only transport override cannot be enabled by API input."""

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import pytest
from aiohttp import web

from motion_dna_api.dna import security
from motion_dna_api.dna.runner import run_analysis
from motion_dna_api.dna.security import AnalysisError, Broker


@asynccontextmanager
async def fixture_site(monkeypatch, html=None):
    hits = []

    async def handler(request):
        hits.append((request.path, dict(request.headers)))
        if request.path == "/":
            return web.Response(
                text=html
                or Path(__file__).with_name("fixtures").joinpath("brand.html").read_text(),
                content_type="text/html",
            )
        if request.path == "/redirect":
            raise web.HTTPFound("http://169.254.169.254/latest/meta-data")
        if request.path == "/big":
            return web.Response(body=b"x" * (Broker.max_resource + 1))
        if request.path == "/compressed":
            return web.Response(body=b"small", headers={"Content-Encoding": "gzip"})
        if request.path == "/slow":
            await asyncio.sleep(5)
        if request.path == "/dynamic.json":
            return web.json_response({"public": True})
        if request.path.endswith(".svg"):
            return web.Response(
                text=(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80">'
                    '<rect width="160" height="80" fill="#2563eb"/></svg>'
                ),
                content_type="image/svg+xml",
            )
        return web.Response(status=404)

    app = web.Application()
    app.router.add_get("/{path:.*}", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    base = f"http://fixture.example:{port}"
    real_parse, real_resolve = security.parse_url, security.resolve_public

    def parse(value):
        if value.startswith(base + "/"):
            real_parse(value.replace(f":{port}", "", 1))
            return value
        return real_parse(value)

    async def resolve(value):
        if value.startswith(base + "/"):
            return "fixture.example", port, ["127.0.0.1"]
        return await real_resolve(value)

    monkeypatch.setattr(security, "parse_url", parse)
    monkeypatch.setattr(security, "resolve_public", resolve)
    try:
        yield base, hits
    finally:
        await runner.cleanup()


def test_real_http_broker_blocks_redirects_and_size(monkeypatch):
    async def run():
        async with fixture_site(monkeypatch) as (base, hits):
            broker = Broker()
            response = await broker.fetch(base + "/")
            assert response["status"] == 200
            assert "Cookie" not in hits[0][1]
            for path, code in [
                ("/redirect", "unsafe_url"),
                ("/big", "resource_limit"),
                ("/compressed", "encoded_resource"),
            ]:
                with pytest.raises(AnalysisError) as error:
                    await broker.fetch(base + path)
                assert error.value.code == code
            broker.max_total = 1
            with pytest.raises(AnalysisError, match="download limits"):
                await broker.fetch(base + "/")
            broker.max_requests = 0
            with pytest.raises(AnalysisError, match="request limit"):
                await broker.fetch(base + "/")

    asyncio.run(run())


@pytest.mark.skipif(
    os.environ.get("DNA_BROWSER_TESTS") != "1",
    reason="Run pnpm test:analyzer with Docker image built",
)
def test_isolated_browser_extracts_dynamic_fixture(monkeypatch):
    async def run():
        async with fixture_site(monkeypatch) as (base, hits):
            # Asset URLs in the fixture use a test port, so remove them from the persisted
            # reference contract in this test only; their image classification is tested separately.
            import motion_dna_api.dna.models as models

            monkeypatch.setattr(models, "parse_url", security.parse_url)
            result, png = await run_analysis(base + "/", uuid4(), "motion-dna-analyzer:1")
            assert png.startswith(b"\x89PNG")
            assert result.schema_version == "1.0"
            assert any(c.value == "#112233" and c.role == "background" for c in result.palette)
            assert any(c.value == "#ff0000" and c.role == "background" for c in result.palette)
            assert any(c.value == "#2563eb" and c.role == "primary" for c in result.palette)
            assert any(h.level == 3 for h in result.typography.headings)
            assert any(
                "MissingFixture" in f.family and not f.available for f in result.typography.fonts
            )
            assert any(m.animation == "arrive" for m in result.motion)
            assert {a.kind for a in result.assets} >= {"logo_candidate", "hero_illustration"}
            assert any(a.url.endswith("/background.svg") for a in result.assets)
            assert any(f.kind == "grid" and f.count == 1 for f in result.layout.features)
            assert any(path == "/dynamic.json" for path, _ in hits)
            assert "never-capture-this" not in result.model_dump_json()
            assert result.motion_scope == "computed-css-only"

    asyncio.run(run())


@pytest.mark.skipif(os.environ.get("DNA_BROWSER_TESTS") != "1", reason="Docker integration test")
def test_browser_timeout_and_redirect_failure(monkeypatch):
    async def run():
        async with fixture_site(monkeypatch) as (base, _):
            with pytest.raises(AnalysisError, match="time limit"):
                await run_analysis(base + "/slow", uuid4(), "motion-dna-analyzer:1", timeout=1)
            with pytest.raises(AnalysisError):
                await run_analysis(base + "/redirect", uuid4(), "motion-dna-analyzer:1")

    asyncio.run(run())


@pytest.mark.skipif(os.environ.get("DNA_BROWSER_TESTS") != "1", reason="Docker fixture integration")
def test_director_from_three_real_fixture_captures(monkeypatch):
    from motion_dna_api.director.models import DirectorInput, Storyboard
    from motion_dna_api.director.service import direct

    async def run():
        for category in ["saas", "ecommerce", "portfolio"]:
            html = (
                Path(__file__)
                .with_name("fixtures")
                .joinpath("director", category + ".html")
                .read_text()
            )
            async with fixture_site(monkeypatch, html=html) as (base, _):
                dna, _ = await run_analysis(base + "/", uuid4(), "motion-dna-analyzer:1")
                assert dna.content.headings
                board = await direct(DirectorInput(dna=dna))
                assert board.category == category
                assert len(board.scenes) == 4
                Storyboard.model_validate_json(board.model_dump_json())

    asyncio.run(run())
