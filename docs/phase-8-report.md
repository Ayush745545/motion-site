# Phase 8 — Source-code DNA engine

Implemented in `/Users/aysuh/Desktop/motion-dna`.

## Completed

- Static source inspection for ZIP projects, public GitHub repository roots, saved single source files, and trusted local directories through a development-only CLI.
- Versioned `SourceDNA` output validated by Pydantic in FastAPI and Zod in the web app.
- Technology/dependency fingerprint, styling systems, CSS design tokens, component/export paths, Next.js and pages routes, declared animation libraries, README/package summaries, heuristic category, source asset references, motion opportunities, and a four-scene deterministic storyboard.
- DNA analysis page controls for GitHub URL, ZIP upload, saved project source, and importing validated local CLI JSON. Results save with the local project and remain visible after reload.
- Public GitHub fetching is constrained to `github.com` input and pinned public HTTPS connections to the metadata API and `codeload.github.com`; cookies and proxy environment settings are disabled.
- ZIP inputs stay in memory and enforce archive, expanded size, file count, per-file size, compression ratio, path depth, duplicate, encryption, special-file, and symlink limits.
- Local directory traversal is restricted to the explicit trusted-development CLI mode. It rejects symlinks, and production mode disables it.
- Repository scripts, package hooks, imports, and build commands are never executed. Environment files, keys, common credential files, build outputs, and dependency directories are excluded.
- Static assets are returned as path references and marked unavailable for rendering. No archive is retained or extracted.

## Main files

- API: `apps/api/src/motion_dna_api/source/{models,archive,github,service,routes,local_cli}.py`
- Shared result contract: `packages/dna-schema/src/source.ts`
- Same-origin upload proxy: `apps/web/src/app/api/source/analyze/route.ts`
- Analysis UI: `apps/web/src/components/source-dna.tsx` and `source-dna.css`, integrated into `dna-analysis.tsx`
- Sample Next.js repository: `apps/api/tests/fixtures/source-next/`
- Tests: `apps/api/tests/test_source.py`, `apps/web/tests/source-proxy.test.ts`, `tests/contracts.test.ts`, and `tests/e2e/source-dna.spec.ts`
- Operation and security notes: `docs/source-code-analysis.md`

## Verification

- `UV_CACHE_DIR=/private/tmp/uv-motion-dna pnpm test` — **180 passed, 4 skipped**: 15 motion-engine, 6 shared-contract, 49 web, and 110 API tests. The four skips are the existing optional Docker analyzer cases and opt-in render database integration.
- `UV_CACHE_DIR=/private/tmp/uv-motion-dna pnpm lint` — passed ESLint, Ruff, and Ruff format checks.
- `pnpm typecheck` — passed all workspace TypeScript projects.
- `pnpm --filter @motion-dna/web build` — passed optimized production build, including `/api/source/analyze`.
- `PLAYWRIGHT_REUSE_LOCAL_STACK=1 pnpm exec playwright test tests/e2e/source-dna.spec.ts` — **1 passed**. Imported the sample local signature, displayed technologies and story scenes, and verified persistence after reload.
- Source API tests — **19 passed**. They analyze a ZIP of the sample Next.js fixture, validate its framework/dependencies/routes/tokens/components/assets and four scenes, check that an embedded environment secret and package lifecycle script are absent, and cover malformed/oversized archives, traversal, symlinks, GitHub URL restrictions, origin checks, and content changes.
- Trusted local CLI was run against the sample Next.js fixture with `SOURCE_LOCAL_MODE=1`; it returned a schema `1.0` local-directory result with Next.js, React, and four scenes.
- The live same-origin `/api/source/analyze` ZIP route analyzed the sample Next.js repository and returned schema `1.0`, Next.js/React, `/`, `/studio`, `/api/status`, and four storyboard scenes. The result contained neither the fixture lifecycle script nor its environment secret. `/api/ready` reported PostgreSQL connected and the rebuilt web app returned HTTP 200.
- The pinned GitHub adapter fetched one public Next.js repository through GitHub metadata and codeload, then returned a valid four-scene schema with Next.js and React identified. No repository scripts were run.

## Limits

Only repository-root URLs are accepted, using the repository's default branch. Product category and descriptions are heuristics over README/package metadata. The analysis does not build or launch a project, evaluate runtime UI, or reconstruct JavaScript animation behavior. Asset contents are not retained or rendered; users must explicitly import visual assets in the editor. Imported local JSON is schema-validated, but its origin cannot be cryptographically verified.
