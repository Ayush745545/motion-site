import asyncio
import json
from html.parser import HTMLParser
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from motion_dna_api.config import Settings
from motion_dna_api.director.models import DirectorInput, Plan, Storyboard
from motion_dna_api.director.providers import HTTPProvider
from motion_dna_api.director.service import direct, facts_for, fallback_plan
from motion_dna_api.main import create_app

ROOT = Path(__file__).resolve().parents[3]


class WebsiteText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.kind = None
        self.content = {"title": "", "headings": [], "paragraphs": [], "ctas": []}

    def handle_starttag(self, tag, attrs):
        self.kind = {"title": "title", "h1": "headings", "p": "paragraphs", "a": "ctas"}.get(tag)

    def handle_data(self, text):
        if self.kind == "title":
            self.content["title"] = text
        elif self.kind:
            self.content[self.kind].append(text)

    def handle_endtag(self, tag):
        self.kind = None


def fixture_input(category="saas", **patch):
    dna = json.loads((ROOT / "packages/motion-engine/src/sample-dna.json").read_text())
    parser = WebsiteText()
    parser.feed(
        Path(__file__).with_name("fixtures").joinpath("director", category + ".html").read_text()
    )
    dna["content"] = parser.content
    return DirectorInput(dna=dna, **patch)


@pytest.mark.parametrize("category", ["saas", "ecommerce", "portfolio"])
def test_fixture_websites_produce_grounded_four_scene_storyboards(category):
    data = fixture_input(category)
    story = asyncio.run(direct(data))
    assert story.category == category
    assert len(story.scenes) == 4
    assert sum(s.duration_frames for s in story.scenes) == 450
    assert story.generation.model == "rules-v1"
    assert story.generation.fallback_used
    assert Storyboard.model_validate_json(story.model_dump_json()) == story
    facts = {fact.text for fact in story.evidence}
    assert story.opening_hook in facts
    assert all(copy in facts for scene in story.scenes for copy in scene.supporting_copy)
    assert story.cta == data.dna.content.ctas[0]


def test_content_changes_hook_highlights_and_pacing_without_inventing_features():
    saas = asyncio.run(direct(fixture_input()))
    shop = asyncio.run(direct(fixture_input("ecommerce")))
    assert saas.opening_hook != shop.opening_hook
    assert saas.scenes[2].supporting_copy != shop.scenes[2].supporting_copy
    assert saas.scenes[1].duration_frames > saas.scenes[0].duration_frames
    assert saas.scenes[1].duration_frames != shop.scenes[1].duration_frames
    assert "checkout" not in saas.model_dump_json().lower()
    changed = fixture_input()
    changed.dna.content.headings = ["Plan a community garden."]
    assert asyncio.run(direct(changed)).opening_hook == "Plan a community garden."


@pytest.mark.parametrize("seconds", [8, 15, 23, 60])
def test_exact_pacing_and_deterministic_regeneration(seconds):
    data = fixture_input(duration_seconds=seconds, variant=2)
    a, b = asyncio.run(direct(data)), asyncio.run(direct(data))
    assert a == b
    assert sum(s.duration_frames for s in a.scenes) == seconds * 30
    assert a.opening_hook != asyncio.run(direct(fixture_input())).opening_hook


@pytest.mark.parametrize("category", ["agency", "mobile", "technology"])
def test_remaining_categories_are_supported(category):
    assert asyncio.run(direct(fixture_input(product_category=category))).category == category


class FakeProvider:
    name, model = "local", "fixture-model"

    def __init__(self, plan=None, error=False):
        self.plan, self.error = plan, error

    async def generate(self, context):
        if self.error:
            raise RuntimeError("private token or provider internals")
        return self.plan


def test_valid_provider_plan_records_model():
    data = fixture_input()
    plan = fallback_plan(data, facts_for(data), "saas")
    result = asyncio.run(direct(data, FakeProvider(plan)))
    assert result.generation.model == "fixture-model"
    assert not result.generation.fallback_used


@pytest.mark.parametrize("bad", ["unknown_fact", "wrong_frames", "injected_copy", "failure"])
def test_bad_provider_falls_back_without_claims_or_secret_leaks(bad):
    data = fixture_input()
    plan = fallback_plan(data, facts_for(data), "saas").model_dump()
    if bad == "unknown_fact":
        plan["scenes"][0]["fact_ids"] = ["fact-999"]
    elif bad == "wrong_frames":
        plan["scenes"][0]["duration_frames"] += 1
    elif bad == "injected_copy":
        plan["scenes"][0]["headline"] = "Guaranteed 10x revenue"
    result = asyncio.run(direct(data, FakeProvider(plan, error=bad == "failure")))
    assert result.generation.fallback_used
    assert result.generation.requested_model == "fixture-model"
    assert "10x" not in result.model_dump_json()
    assert "private token" not in result.model_dump_json()


def test_no_evidence_uses_neutral_copy():
    data = fixture_input()
    data.dna.content = None
    story = asyncio.run(direct(data))
    assert story.opening_hook == "Explore the website."
    assert story.generation.confidence == 0.1


def test_schema_rejects_missing_scenes_unknown_evidence_and_frame_mismatch():
    story = asyncio.run(direct(fixture_input())).model_dump()
    for field, value in [("scenes", []), ("total_frames", 451)]:
        with pytest.raises(ValidationError):
            Storyboard.model_validate({**story, field: value})
    with pytest.raises(ValidationError):
        Plan.model_validate({"scenes": []})


def test_api_and_validation():
    with TestClient(create_app(Settings(_env_file=None, app_env="test"))) as client:
        result = client.post(
            "/api/director/storyboard", json=fixture_input().model_dump(mode="json")
        )
        assert result.status_code == 200
        Storyboard.model_validate(result.json())
        assert client.post("/api/director/storyboard", json={"dna": {}}).status_code == 422
        assert (
            client.post(
                "/api/director/storyboard",
                json=fixture_input().model_dump(mode="json"),
                headers={"Origin": "https://evil.example"},
            ).status_code
            == 403
        )


def test_generic_api_and_local_adapters_use_real_local_http(monkeypatch):
    from aiohttp import web

    async def run():
        data = fixture_input()
        plan = fallback_plan(data, facts_for(data), "saas").model_dump()
        seen = []

        async def handler(request):
            if request.path == "/large":
                return web.Response(body=b"x" * 70000)
            if request.path == "/redirect":
                raise web.HTTPFound("http://169.254.169.254/")
            if request.path == "/slow":
                await asyncio.sleep(0.1)
            payload = await request.json()
            seen.append((request.path, payload, request.headers.get("Authorization")))
            if request.path == "/local":
                return web.json_response(
                    {"model": "actual-fixture-v1", "message": {"content": json.dumps(plan)}}
                )
            return web.json_response({"model": "actual-fixture-v1", "plan": plan})

        app = web.Application()
        app.router.add_post("/{kind}", handler)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        try:
            for kind in ["local", "api"]:
                provider = HTTPProvider(
                    kind, "fixture-model", f"http://127.0.0.1:{port}/{kind}", "test-only"
                )
                result = await direct(data, provider)
                assert not result.generation.fallback_used
                assert result.generation.provider == kind
                assert result.generation.model == "actual-fixture-v1"
                assert result.generation.requested_model == "fixture-model"
            assert seen[0][1]["stream"] is False
            assert "format" in seen[0][1]
            assert "output_schema" in seen[1][1]
            assert seen[1][2] == "Bearer test-only"
            for kind in ["large", "redirect"]:
                provider = HTTPProvider("api", "fixture-model", f"http://127.0.0.1:{port}/{kind}")
                assert (await direct(data, provider)).generation.fallback_used
            import aiohttp

            original_timeout = aiohttp.ClientTimeout
            monkeypatch.setattr(aiohttp, "ClientTimeout", lambda **kw: original_timeout(total=0.01))
            provider = HTTPProvider("api", "fixture-model", f"http://127.0.0.1:{port}/slow")
            assert (await direct(data, provider)).generation.fallback_used
        finally:
            await runner.cleanup()

    asyncio.run(run())


@pytest.mark.parametrize(
    "url",
    [
        "http://public.example/api",
        "https://user:secret@example.com/api",
        "file:///tmp/model",
        "https://example.com/api?token=x",
    ],
)
def test_provider_endpoint_configuration_rejects_unsafe_forms(url):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, director_url=url)
