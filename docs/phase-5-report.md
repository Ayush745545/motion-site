# Phase 5 — AI Video Director

Implemented on 2026-10-28 in `/Users/aysuh/Desktop/motion-dna`.

## Completed

- `POST /api/director/storyboard`, with bounded input, origin checks, concurrency limits and a fully validated four-scene response.
- Independent provider protocol, optional local Ollama adapter, optional generic API gateway adapter and a deterministic `rules-v1` fallback requiring no model or key.
- Category inference for SaaS, e-commerce, portfolio, agency, mobile application and technology startup. Category-specific frame weights prioritize relevant reveals/highlights while preserving the exact requested frame budget.
- Structured concept, hook, ordered scenes, descriptions, headlines, evidence IDs, source asset references, motion presets, transitions, frame durations, CTA and confidence/fallback/model provenance.
- Grounding by construction: optional models select evidence and direction; copy is assembled locally from source excerpts. Unknown evidence, unsupported fields, broken timing and provider errors use the validated deterministic plan.
- Bounded public website content in the existing anonymous Playwright extractor, excluding forms, editable/private-marked content and script/style text. Old DNA documents remain compatible.
- `/director` with generation/regeneration, brief controls, editable scene copy, reorder controls, presets/transitions, JSON download, source evidence and real Remotion preview. Project storyboards and generator metadata persist locally.
- Director-driven scene order, copy, description captions, presets/transitions and variable 8–60 second timing in both Player and MP4 export.

## Files added and updated

New backend modules: `apps/api/src/motion_dna_api/director/{__init__,models,providers,service,routes}.py`.

New shared contracts/artifacts: `packages/dna-schema/src/director.ts`, `storyboard-v1.schema.json` and three `fixtures/storyboard-{saas,ecommerce,portfolio}.json` documents.

New UI: `apps/web/src/app/director/page.tsx`, `components/director.tsx`, `director.css`, `storyboard-preview.tsx`, and the same-origin `app/api/director/storyboard/route.ts`.

New tests: `apps/api/tests/test_director.py`, three HTML sites under `tests/fixtures/director`, `tests/e2e/director.spec.ts`; existing browser-capture, engine and project DNA acceptance tests were extended.

Updated API configuration/app assembly, typed environment examples, DNA schemas/extractor, local project schema, video workspace, composition/root/frame helpers, navigation, README and operating guides.

## Verification

Commands executed: `pnpm check`, `pnpm setup:analyzer`, `pnpm test:analyzer`, `VIDEO_RENDER_TESTS=1 DNA_LIVE_TESTS=1 pnpm test:e2e`, scoped API/engine checks, `pnpm motion:render` and FFprobe inspection.

- Unit tests cover three fixture sites, all six category modes, meaningful content changes, deterministic regeneration, four unique scenes, frame budgets, malformed provider plans, ungrounded references, transport failure/timeout/size/redirect behavior and endpoint validation.
- The real isolated Chromium fixture suite captured all three websites and generated valid four-scene storyboards directly from their extracted public content. Four fixture tests passed, including existing capture checks.
- Both optional provider adapters were tested over real local HTTP with their documented request/response contracts, reported model provenance and graceful fallback. No installed Ollama model or external paid LLM call is claimed as live-verified.
- Browser coverage includes generation/regeneration, scene editing, reorder/preset/transition changes, responsive preview, persistence across reload, actual backend DNA consumption, video studio handoff and actual MP4 encoding/download.
- A Director-driven variable-duration MP4 was rendered to `storage/renders/phase5-director-20s.mp4`: FFprobe confirmed 1920×1080, 30 FPS, 20.000 seconds and 600 decoded frames.
- Desktop/mobile Director screenshots were inspected under `.cache/screenshots/phase5-director-*.png`.

The initial browser integration caught an accessible-name mismatch on the video-studio link; its explicit label was corrected before the final acceptance run. Existing manual-editing, DNA extraction and local render behavior remain covered by the regression suite.

Final verification passed **136 unit tests** (7 motion engine, 5 shared contracts, 38 web and 86 API/security), **12 browser acceptance tests**, and **4 isolated-browser fixture tests**. Lint, strict TypeScript, Remotion bundling, Next.js production build and Python package build passed. Three Docker-only cases are skipped in the default unit command and covered separately by the fixture command.

The UI also suppresses preview until the matching capture is loaded, and flags saved storyboards from an earlier analysis instead of mixing source material.

## Limits

Source grounding verifies quotation/reference consistency, not whether a website's own claims or a supplied summary are true. Classification/confidence is heuristic. User edits are marked and are the user's own copy decisions.

Descriptions are visual-direction captions in the current renderer; arbitrary natural-language animation synthesis is not implemented. External asset candidates are referenced without fetching them in the renderer. The existing capture and generated monogram remain the rendered visual sources.

Local/API LLM providers are optional and configured server-side. A vendor-specific endpoint may require a gateway implementing the documented generic contract. Failed providers use deterministic direction; a stopped FastAPI service cannot generate a new storyboard until it is restarted.

Project persistence is browser-local. Distributed scheduling, hosted authentication, arbitrary footage retrieval and generative video APIs remain outside this phase.

See [AI Director guide](ai-director.md) for setup, contracts and detailed behavior.
