# Phase 7 — Local video rendering pipeline

Implemented in `/Users/aysuh/Desktop/motion-dna`.

## Completed

- Durable PostgreSQL-backed render jobs with project ownership checks and idempotent creation.
- Independent Python worker that claims jobs under a lease, runs a fixed Remotion command, tracks renderer callbacks, records bounded logs, and verifies completed MP4 files with FFprobe before publishing them.
- H.264 MP4 export at 720p or 1080p, landscape 16:9 or portrait 9:16, and 24, 30, or 60 FPS.
- Queued/running/completed/failed/cancelled states, real persisted progress, cancellation of active subprocess groups, bounded retries, and terminal failure reasons.
- Same-origin frontend submit, status, cancel, retry and byte-range download routes; project-scoped render queue controls and error/empty/loading states.
- Render input, duration/frame count, output dimensions, output size, concurrency, attempt count, renderer runtime, and log size are bounded. Arbitrary executable arguments are not accepted.
- The Remotion export uses the same DNA/timeline composition code as the frontend preview.

## Main files

- API queue: `apps/api/src/motion_dna_api/renders/{models,repository,routes,worker}.py`
- Frontend routes: `apps/web/src/app/api/motion/render/` and `apps/web/src/app/api/render-jobs/`
- Queue UI and client: `apps/web/src/components/render-queue.tsx`, `apps/web/src/components/use-render-job.ts`, and `apps/web/src/lib/server/renders.ts`
- Shared rendering: `packages/motion-engine/src/ExportComposition.tsx`, `TimelineComposition.tsx`, `render-input.ts`, `render-request.ts`, and `scripts/render.ts`
- Verification: `apps/api/tests/test_renders.py`, `tests/e2e/video-generation.spec.ts`, and `tests/e2e/timeline.spec.ts`
- Operating guide: `docs/video-rendering.md`

## Verification

- `UV_CACHE_DIR=/private/tmp/uv-motion-dna pnpm lint` — passed, including ESLint, Ruff checks, and Ruff formatting.
- `pnpm typecheck` — passed.
- `pnpm test` — **156 passed, 4 skipped** (15 motion-engine, 5 shared-contract, 45 web, and 91 API tests). Skips are optional Docker analyzer cases and the opt-in render database integration.
- `RENDER_DATABASE_TESTS=1 UV_CACHE_DIR=/private/tmp/uv-motion-dna uv run --directory apps/api pytest tests/test_renders.py -q` — **6 passed**, including PostgreSQL idempotency, project scoping, worker claim, cancellation, retry bounds, and terminal failure behavior.
- `pnpm --filter @motion-dna/web build` — passed optimized production build.
- `PLAYWRIGHT_REUSE_LOCAL_STACK=1 VIDEO_RENDER_TESTS=1 pnpm exec playwright test tests/e2e/video-generation.spec.ts` — **4 passed**. Includes live cancellation and download/range/ownership checks.
- `PLAYWRIGHT_REUSE_LOCAL_STACK=1 TIMELINE_RENDER_TESTS=1 pnpm exec playwright test tests/e2e/timeline.spec.ts` — **3 passed**, including edit, undo, and MP4 export from the saved timeline document.
- `/api/ready` reported PostgreSQL connected; the frontend `/api/health` proxy reported the API healthy.
- Independent FFprobe of `storage/renders/92385e17-29b1-4eda-86aa-917fd6d30379/video.mp4`: **H.264, 720×1280, 24 FPS, 15.000 seconds, 360 frames** (691,481 bytes).
- Independent FFprobe of `storage/renders/cb14e143-5ace-48de-96b2-608d0b976f96/video.mp4`: **H.264, 1920×1080, 30 FPS, 12.000 seconds, 360 frames** (130,383 bytes); this is the timeline edit/undo acceptance export.

## Build limitation

The workspace `pnpm build` successfully completed the Next.js production build, then stopped during Python wheel packaging because `uv build` could not download the pinned `hatchling==1.32.4` build backend from the package registry in this network-restricted environment. The Python API tests and lint checks ran successfully; the Python distributable was not built here.

## Limits

Rendering is a local single-worker workflow. Cloud storage, distributed scheduling, multi-worker parallelism, user authentication, and remote render machines are outside this phase. The API's project UUID checks provide local ownership consistency, not account authorization. The four skipped default-suite tests require the analyzer Docker image or explicitly enabling the database integration as described above.
