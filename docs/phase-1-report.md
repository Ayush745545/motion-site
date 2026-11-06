# Phase 1 implementation report

Verified on macOS, 27 October 2026. Repository: `/Users/aysuh/Desktop/motion-dna`.

## Delivered behavior

- pnpm monorepo with Next.js, React, strict TypeScript, Tailwind CSS, a separately packaged Python 3.12 FastAPI application, and shared configuration, contract, and UI packages.
- Responsive local studio with real service status, automatic checks, manual retries, and offline recovery. The motion study is an explicitly labeled illustration.
- `GET /api/health`: live FastAPI response, independent of PostgreSQL.
- `GET /api/ready`: a real PostgreSQL `SELECT 1`, returning 200 when connected and a structured 503 when unavailable.
- Next.js same-origin proxies with upstream response validation, timeouts, request IDs, and sanitized errors.
- Pydantic settings, Zod validation, explicit CORS origins, JSON logs, and a secret-free environment example.
- PostgreSQL Compose configuration plus an optional isolated native launcher. The native launcher owns only `.cache/postgres` and preserves its data on shutdown.
- Reproducible locked installs, application and shared-package tests, browser integration tests, linting, typechecking, and production/package builds.

## Running locally

The development services were left running at:

| Service | Address |
| --- | --- |
| Next.js | `http://127.0.0.1:3000` |
| FastAPI health | `http://127.0.0.1:8000/api/health` |
| FastAPI readiness | `http://127.0.0.1:8000/api/ready` |
| API reference | `http://127.0.0.1:8000/docs` |
| Isolated native PostgreSQL | `127.0.0.1:55432` |

The local gitignored `.env` uses PostgreSQL port 55432 because another PostgreSQL instance already occupied 5432. The example configuration defaults to 5432. Existing databases were left intact.

For a fresh setup, follow [the macOS development guide](development.md). Application processes must stay running for these addresses to remain available. Stop the combined application with Control-C in its terminal; stop the native database separately with `pnpm db:native:down`.

## Verification

| Check | Result |
| --- | --- |
| Shared runtime/configuration unit tests | 4 passed |
| Web proxy and component unit tests | 13 passed |
| FastAPI unit tests | 22 passed |
| Playwright Chromium integration tests | 3 passed |
| ESLint, including shared packages and scripts | Passed |
| Ruff lint and formatting | Passed |
| Strict TypeScript checks | Passed |
| Next.js production build | Passed |
| Built production server HTTP smoke check | Interface, health, and readiness returned 200 |
| Python wheel and source distribution | Passed |
| Frozen pnpm install from cached dependencies | Passed |
| Frozen uv environment synchronization | Passed |
| Compose configuration validation | Passed |

The browser tests exercise the actual running API and database, desktop navigation and connection refresh, a 390px mobile viewport, and recovery from a simulated browser-facing API failure. Desktop and mobile screenshots were also inspected.

Live HTTP checks returned 200 from FastAPI health, PostgreSQL readiness, and the Next.js health proxy. Stopping the isolated PostgreSQL process kept liveness at 200 and changed readiness to 503 with a sanitized, request-correlated error. Restarting it restored the Next.js readiness proxy to 200.

The Python build artifacts are in `apps/api/dist/`. Next.js build output is in `apps/web/.next/`. The built Next.js server was also started temporarily on port 3001 and verified against the real API and database, then stopped.

## Commands executed

Relevant installation and verification commands, run from the repository root:

```bash
cp -n .env.example .env
pnpm install
uv sync --directory apps/api --python python3.12
pnpm setup:api
node scripts/native-postgres.mjs up
pnpm dev
pnpm test:shared
pnpm --filter @motion-dna/web test
pnpm test:api
pnpm lint
pnpm typecheck
pnpm build
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm install --frozen-lockfile --offline
pnpm peers check
docker compose -f infra/compose.yaml config --quiet
curl --fail http://127.0.0.1:8000/api/health
curl --fail http://127.0.0.1:8000/api/ready
curl --fail http://127.0.0.1:3000/api/health
node scripts/native-postgres.mjs down
node scripts/native-postgres.mjs up
```

Dependency metadata was inspected with `npm view`. Readiness failure and recovery were asserted with Node's HTTP client. In the Codex sandbox, uv commands used `UV_CACHE_DIR=/private/tmp/motion-dna-uv-cache`, and processes/browser checks needed permission to use local networking. The final full check used `UV_OFFLINE=1` with already installed dependencies after the sandbox blocked a PyPI metadata refresh. The Python build backend is pinned. Normal macOS setup uses the documented commands without that cache override.

## Remaining limitations

- This phase does not ingest URLs/source, persist projects, extract visual DNA, generate videos, expose a timeline, or render with Remotion/FFmpeg. Those capabilities remain for later phases. Redis and background workers are deliberately deferred.
- Docker's daemon was stopped on this machine. Its Compose file was validated, while live database verification used the isolated native PostgreSQL 17 instance.
- No deployment, authentication, or production hardening was requested or implemented.
- The test client emits an upstream Starlette warning recommending `httpx2`. The pinned `httpx` client passes all tests. ESLint 9 remains pinned because bundled Next.js lint plugins do not yet declare ESLint 10 compatibility; its package emits an upstream deprecation notice during installation.

## Files created

The inventory below excludes dependencies, caches, generated build output, browser reports, and the local `.env`.

```text
.env.example
.gitignore
.nvmrc
.python-version
README.md
apps/api/README.md
apps/api/pyproject.toml
apps/api/src/motion_dna_api/__init__.py
apps/api/src/motion_dna_api/__main__.py
apps/api/src/motion_dna_api/config.py
apps/api/src/motion_dna_api/database.py
apps/api/src/motion_dna_api/logging.py
apps/api/src/motion_dna_api/main.py
apps/api/src/motion_dna_api/models.py
apps/api/tests/test_api.py
apps/api/uv.lock
apps/web/AGENTS.md
apps/web/eslint.config.mjs
apps/web/next-env.d.ts
apps/web/next.config.ts
apps/web/package.json
apps/web/postcss.config.mjs
apps/web/src/app/api/health/route.ts
apps/web/src/app/api/ready/route.ts
apps/web/src/app/error.tsx
apps/web/src/app/globals.css
apps/web/src/app/layout.tsx
apps/web/src/app/not-found.tsx
apps/web/src/app/page.tsx
apps/web/src/components/icon.tsx
apps/web/src/components/studio.tsx
apps/web/src/lib/backend.ts
apps/web/tests/backend.test.ts
apps/web/tests/studio.test.tsx
apps/web/tsconfig.json
apps/web/vitest.config.ts
docs/architecture.md
docs/development.md
docs/phase-1-report.md
eslint.config.mjs
infra/compose.yaml
package.json
packages/config/package.json
packages/config/src/index.ts
packages/config/tsconfig.json
packages/dna-schema/package.json
packages/dna-schema/src/index.ts
packages/dna-schema/tsconfig.json
packages/motion-engine/README.md
packages/ui/package.json
packages/ui/src/index.tsx
packages/ui/tsconfig.json
playwright.config.ts
pnpm-lock.yaml
pnpm-workspace.yaml
scripts/dev.mjs
scripts/native-postgres.mjs
storage/README.md
tests/contracts.test.ts
tests/e2e/foundation.spec.ts
tsconfig.base.json
tsconfig.json
workers/README.md
```
