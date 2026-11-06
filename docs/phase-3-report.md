# Phase 3 implementation report

Implemented and verified on 2026-10-28 in `/Users/aysuh/Desktop/motion-dna`.

## Completed

- Real `POST /api/dna/analyze`, `GET /api/dna/jobs/{job_id}`, and `GET /api/dna/results/{analysis_id}` routes, plus a bounded local PNG screenshot endpoint.
- Isolated Python Playwright capture with a networkless Docker container and a public-only, DNS-pinned HTTP broker. Redirects/subresources use the same policy. No host browser fallback, user cookies, credentials, uploaded code execution or paid AI API.
- Version 1.0 validated DNA output: color roles/frequency, modern CSS colors normalized to sRGB, typography and heading hierarchy, layout candidates/density, computed CSS motion, visible images/background-image references, confidence and capture warnings.
- Durable PostgreSQL jobs, result JSON and screenshots, atomic successful completion, bounded history, concurrency limits and interrupted-job handling.
- Working DNA Analysis UI: start/retry, pending/failure states, real extracted results, screenshot, JSON link and reload persistence. Project draft settings remain separate from extracted observations. Responsive desktop/mobile layouts were visually inspected.
- Explicit incoming-body, DNS, HTTP, page-load, total-runtime, resource-count, download-size, process, memory and CPU limits. Private/metadata destinations are rejected rather than silently analyzed.

## Files added

- `apps/api/src/motion_dna_api/dna/{__init__,security,models,repository,runner,routes}.py`
- `workers/analyzer/{Dockerfile,worker.py,extract.js}`
- `packages/dna-schema/src/analysis.ts` and `packages/dna-schema/dna-v1.schema.json`
- `apps/web/src/app/api/dna/[...path]/route.ts`
- `apps/web/src/components/website-dna.tsx`
- `apps/api/tests/{test_dna_security,test_dna_capture,test_dna_api}.py`
- `apps/api/tests/fixtures/brand.html`
- `apps/web/tests/{dna-proxy.test.ts,website-dna.test.tsx}`
- `tests/e2e/dna-analysis.spec.ts`
- `docs/website-analysis.md` and this report.

Updated the API app/config/dependency lock, shared environment/contracts, local project schema, existing DNA page/styles, workspace commands/lint coverage, `.env.example`, README and development/architecture guides.

## Commands and results

| Command | Result |
| --- | --- |
| `open -a Docker` / `docker info` | Local Docker engine started and verified |
| `uv add --directory apps/api 'aiohttp>=3.12,<4'` | Added the streaming HTTP broker dependency and updated `uv.lock` |
| `pnpm setup:analyzer` | Built the pinned Playwright 1.64.0 container; base image is pinned by digest |
| `pnpm check` | Passed ESLint, Ruff, strict TypeScript, tests, Next production build and Python wheel/sdist build |
| `pnpm test:analyzer` | 3 real HTTP/browser fixture tests passed, including isolated Chromium extraction and timeout/redirect failures |
| `DNA_LIVE_TESTS=1 pnpm test:e2e` | All 8 browser acceptance tests passed |
| Live API POST/job/result/PNG requests | Actual public `example.com` capture completed and persisted in PostgreSQL |
| `docker ps --filter name=motion-dna-` | No leftover capture containers after verification |

The regular test suite passed **105 tests**: 5 shared-contract tests, 38 web tests and 62 API/security tests. Two Docker-only cases are intentionally skipped by the default unit command and were run successfully by `pnpm test:analyzer` (that command also repeats one HTTP-broker test). Live browser tests verified submission through Next.js, real result validation, loaded screenshot pixels, reload persistence, mobile overflow and unsafe-URL rejection. The seven existing studio acceptance tests also passed.

The browser test caught an initial loopback-origin mismatch; the proxy now uses the explicit validated origin allowlist. The fixture suite also verifies dynamic DOM/fetch content, missing fonts, modern CSS colors, CSS animations, background images, logo/hero candidates, unsafe redirects, mixed DNS answers/rebinding, numeric/metadata addresses, encoded responses and request/download limits.

Screenshots were inspected at `.cache/screenshots/phase3-analysis-desktop.png` and `.cache/screenshots/phase3-analysis-mobile.png`. Runtime-generated files remain ignored. PostgreSQL continues using the existing workspace-native port 55432. No existing shared database was replaced.

## Remaining limits

- Motion analysis is **computed CSS only**. JavaScript animation libraries, scroll interactions, canvas and complete animation trajectories are not analyzed.
- Classification/confidence is heuristic, not a calibrated brand inference model. Font checks do not prove which fallback rendered each glyph.
- Capture is a bounded desktop snapshot. No login, cookie acceptance, scrolling, iframe capture, source-code execution or captcha bypass. Late-loading/large/unsupported resources can produce warnings or fail a capture.
- Results use local PostgreSQL; draft projects remain browser-local. The dispatcher is in-process, with no Redis or restart/resume scheduler. This is a local development service, not an authenticated multi-tenant deployment.
- Docker is required for extraction. Video rendering remains unimplemented and is still honestly disabled.

See [website analysis](website-analysis.md) for exact macOS setup, endpoints, schema semantics, retention and security details.
