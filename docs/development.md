# macOS development

## 1. Install prerequisites

Use Node.js 22.13+ or 24, uv, and Docker Desktop. With Homebrew:

```bash
brew install node@22 uv
brew install --cask docker
open -a Docker
```

Follow Homebrew's `node@22` shell instructions so `node --version` uses that installation. If Corepack is absent, install it with `npm install --global corepack`. Node.js 24 also works; use the same Node release consistently between installation and builds.

From the repository root:

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
node --version
pnpm --version
uv --version
```

The repository pins pnpm 11.21.0 in its `packageManager` field. You can also install that version with `npm install --global pnpm@11.21.0` when Corepack is unavailable. Do not replace the package manager with npm or Yarn; the workspace and lockfile use pnpm.

## 2. Configure and install

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm setup:api
pnpm setup:analyzer
```

The API uses an isolated virtual environment under `apps/api`; no global Python packages are required. uv uses Python 3.12 and can install that interpreter when it is missing. Initial setup requires access to package registries; normal development requires no paid AI service and no provider credentials.

The committed dependency lockfiles make repeat installs reproducible. Keep `.env` out of version control.

## 3. Start PostgreSQL

Docker Desktop must be running:

```bash
pnpm db:up
```

This starts PostgreSQL 17, binds it to `127.0.0.1:5432`, and waits for `pg_isready`. Data is stored in a named Docker volume.

```bash
pnpm db:down
```

Stopping the service retains the database. Do not remove its volume when restarting development.

### Native PostgreSQL alternative

Use this option for a native database. Website analysis still requires Docker for browser isolation. The repository starts a separate database in `.cache/postgres` and does not modify a Homebrew-managed cluster or shared database roles.

```bash
brew install postgresql@17
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
pnpm db:native:up
```

Keep that PostgreSQL binary directory on your shell path, or set `POSTGRES_BIN` in `.env` to its absolute path. `pg_config --bindir` determines the binaries when `POSTGRES_BIN` is absent. Do not start Docker PostgreSQL and native PostgreSQL on the same port.

The native script initializes the workspace database using `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT`. It listens on loopback, uses password authentication for TCP, and stores its log at `.cache/postgres.log`. Its local Unix socket uses trust authentication for local development.

If port 5432 is occupied, choose another port before starting it. For example, set these two values together in `.env`:

```dotenv
POSTGRES_PORT=55432
DATABASE_URL=postgresql://motiondna:motiondna_local@127.0.0.1:55432/motiondna
```

If the workspace database is already running, stop it with `pnpm db:native:down` before changing its port. Then run `pnpm db:native:up`. Stop this instance with:

```bash
pnpm db:native:down
```

Stopping it retains the data in `.cache/postgres`. Existing native data directories retain their original role and password, just as existing Docker volumes do. Update the existing role deliberately if credentials need to change; editing `.env` alone does not rewrite database credentials. Use the same PostgreSQL major version when reopening an existing data directory.

## 4. Run the applications

```bash
pnpm dev
```

To run services separately, start `pnpm dev:api`, `pnpm dev:web`, and `pnpm dev:worker` in separate terminals. The render worker polls PostgreSQL and uses the local Node.js, Remotion, and FFmpeg installation.

The web interface is [http://127.0.0.1:3000](http://127.0.0.1:3000); the API is [http://127.0.0.1:8000](http://127.0.0.1:8000). FastAPI's interactive reference is at `/docs` on the API origin. Control-C stops the application processes; the database remains running until stopped separately.

Check both kinds of health:

```bash
curl --fail http://127.0.0.1:8000/api/health
curl --fail http://127.0.0.1:8000/api/ready
curl --fail http://127.0.0.1:3000/api/health
```

The first call checks API liveness. The second checks PostgreSQL access. The third verifies the Next.js-to-FastAPI connection used by the interface. The web app may load while the API is unavailable; its live status must show that failure rather than fabricate a successful connection.

## Environment reference

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | API environment: `development`, `test`, or `production` |
| `LOG_LEVEL` | Structured API log severity |
| `API_HOST` | API listen address; loopback by default |
| `API_PORT` | API port; default `8000` |
| `API_BASE_URL` | Server-side Next.js upstream address; default `http://127.0.0.1:8000` |
| `CORS_ALLOWED_ORIGINS` | JSON array of explicit origins allowed by FastAPI; no wildcard |
| `DATABASE_URL` | PostgreSQL connection URL for readiness, DNA jobs/results and screenshots |
| `DNA_BROWSER_IMAGE` | Locally built restricted worker image; default `motion-dna-analyzer:1` |
| `SOURCE_LOCAL_MODE` | Enables the trusted-development local-directory static-analysis CLI; defaults to `0` and is disabled in production |
| `POSTGRES_USER` | Local Compose database role |
| `POSTGRES_PASSWORD` | Local Compose role password |
| `POSTGRES_DB` | Local Compose database name |
| `POSTGRES_PORT` | Loopback port for Compose or native PostgreSQL; default `5432` |
| `POSTGRES_BIN` | Optional absolute PostgreSQL binary directory for native scripts; otherwise use `pg_config --bindir` |

Use `.env.example` as the source of exact defaults and variable names. If you change Compose credentials, also change `DATABASE_URL`. Existing PostgreSQL volumes retain their original credentials; changing Compose environment variables does not rewrite an existing database role. If you change an origin or port, update the corresponding URL and CORS allowlist together and restart development.

The API resolves the root `.env` independently of the shell's working directory. The web setup loads server configuration for the Next.js application. `API_BASE_URL` is not a public browser environment variable.

## Verification and builds

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

`pnpm check` runs the repository's combined checks. Unit tests cover runtime contracts, invalid configuration, HTTP proxy failures, API health/error behavior, and explicit CORS handling. Most unit tests do not require a live database.

Render queue repository tests normally use a fake repository. To verify database idempotency, single-worker claiming, project scoping, cancellation, retry bounds, and failure metadata against local PostgreSQL, stop the render worker and run:

```bash
RENDER_DATABASE_TESTS=1 uv run --directory apps/api pytest tests/test_renders.py -q
```

The integration test uses a fresh project UUID and removes only its own queue row afterward.

Install the Playwright browser and run the browser smoke test:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

The browser suite exercises the actual interface and health integration, including a live PostgreSQL readiness probe and authenticated project workflows. It provisions a temporary account and session in the configured test database for each worker, then removes that account and its owned local media on teardown. Start PostgreSQL with `pnpm db:up` or `pnpm db:native:up` first. Playwright starts `pnpm dev` when the web app is not already running; when it reuses an existing web server, keep the API running too. Run `pnpm test:analyzer` for real Docker browser captures of local fixture sites; run `pnpm test:dna:e2e` for the public-site UI flow. The regular browser suite skips that internet-dependent case and the opt-in real-render cases.

For an account-owned render acceptance, keep PostgreSQL and one `pnpm dev:worker` running, then run `PROJECT_RENDER_TESTS=1 uv run --directory apps/api pytest tests/test_account_render_acceptance.py -q`. It encodes and probes a real MP4, then cleans up its temporary account and project. Set `PLAYWRIGHT_REUSE_LOCAL_STACK=1` to keep Playwright from starting duplicate services when targeting a running stack; `PLAYWRIGHT_BASE_URL` can point the browser checks at an alternate local web port.

`pnpm build` produces an optimized Next.js build and a distributable Python package. The API packaging step needs its Python build backend available from the configured package registry unless it is already cached. To inspect the built web app locally, stop its development server, keep or start the API and render worker, and run `pnpm --filter @motion-dna/web start`. A successful build does not imply that PostgreSQL is reachable; verify `/api/ready` against the running environment separately.

## Troubleshooting

- **Docker daemon unavailable:** launch Docker Desktop, wait until its engine is ready, then retry `pnpm db:up`. The native database alternative remains available, but the analyzer deliberately has no unsandboxed fallback. Run `pnpm setup:analyzer` if the browser image is missing.
- **Port already occupied:** identify the existing process before stopping it. For PostgreSQL, use a different `POSTGRES_PORT` and matching `DATABASE_URL`, or use the isolated native script on another port.
- **API unavailable in the interface:** check the API terminal output, `API_BASE_URL`, and `curl http://127.0.0.1:8000/api/health`. The browser calls Next.js on the same origin; the upstream address is resolved by the server.
- **Readiness returns 503:** check PostgreSQL health, database credentials, and the port in `DATABASE_URL`. Liveness returning 200 during this failure is intentional.
- **CORS request rejected:** ensure the complete origin, including scheme and port, appears in `CORS_ALLOWED_ORIGINS`. Origins are explicitly allowed rather than inferred.
- **Dependency download blocked:** restore registry/network access and rerun the same locked install. Do not substitute placeholder modules or claim a blocked install passed verification.
- **Offline checks after setup:** once Python dependencies and the build backend have been cached, `UV_OFFLINE=1 pnpm check` prevents uv from refreshing package metadata. Initial installation still needs registry access.

## Local accounts and database tests

The web app applies PostgreSQL migrations at API startup. Create a local account from `/login`; saved projects, revisions, DNA results, private images, render history, and exports are scoped to that account. The database-backed ownership test creates two temporary users and removes them after the run:

```bash
PROJECT_DATABASE_TESTS=1 uv run --directory apps/api pytest tests/test_project_management_db.py -q
```

Preferences remain in browser storage. Existing browser drafts are preserved and can be imported after sign-in. Uploaded source code is analyzed as data and is never executed. The DNA video workspace uses a real Remotion Player and local H.264 export; Redis scheduling remains deferred. See [project management](project-management.md) and [motion generation](motion-generation.md).

See [website analysis](website-analysis.md) for endpoint examples, security boundaries, resource limits, retention, and troubleshooting.
