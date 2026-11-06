# Motion DNA AI

A local motion design studio for turning website URLs and source code into customizable promotional motion graphics. The studio includes local project drafts, an editable preview and timeline, preferences, and real website DNA analysis. FastAPI runs an isolated Playwright capture, extracts visual signatures, and persists results and screenshots in PostgreSQL. The shared Remotion engine now previews and exports real 15-second MP4s locally.

No paid AI service or API key is required.

## Workspace

The current checkout folder is `motion-dna`; its pnpm workspace is named `motion-dna-ai`.

```text
motion-dna-ai/
├── apps/
│   ├── web/                 Next.js, React, TypeScript, Tailwind CSS
│   └── api/                 Python 3.12+, FastAPI, Pydantic
├── packages/
│   ├── dna-schema/          Runtime-validated API contracts and TypeScript types
│   ├── motion-engine/       Remotion compositions, five templates and local MP4 renderer
│   ├── ui/                  Shared React presentation components
│   └── config/              Validated web environment configuration
├── workers/analyzer/        Isolated Playwright worker and Docker image
├── storage/renders/         Validated render snapshots, bounded logs, and completed MP4s
├── infra/                   Local PostgreSQL Compose configuration
├── docs/                    Architecture and development instructions
└── README.md
```

## Run on macOS

Install Node.js 22.13+ (or Node.js 24), pnpm 11.21.0 (pinned in `package.json`), [uv](https://docs.astral.sh/uv/getting-started/installation/), and Docker Desktop. Start Docker Desktop before starting PostgreSQL. If Corepack is unavailable, install pnpm with `npm install --global pnpm@11.21.0` and omit the two Corepack commands below. A native PostgreSQL alternative is described in [the development guide](docs/development.md).

```bash
cd /Users/aysuh/Desktop/motion-dna
corepack enable
corepack prepare pnpm@11.21.0 --activate
cp .env.example .env
pnpm install --frozen-lockfile
pnpm setup:api
pnpm setup:analyzer
pnpm db:up
pnpm dev
```

For a native database, install PostgreSQL 17 and use `pnpm db:native:up` in place of `pnpm db:up`; see [native database setup](docs/development.md#native-postgresql-alternative).

Website analysis still requires Docker, including when using native PostgreSQL. The first `pnpm setup:analyzer` downloads a browser image (roughly 1 GB); later builds are cached.

`pnpm setup:api` creates an isolated Python environment using the locked API dependencies. uv can obtain Python 3.12 if needed. `pnpm dev` runs the web app, FastAPI service, and separate local render worker; PostgreSQL must be running first. Control-C stops those processes and leaves the database running.

Open:

- Web interface: [http://127.0.0.1:3000](http://127.0.0.1:3000)
- API liveness: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)
- Database readiness: [http://127.0.0.1:8000/api/ready](http://127.0.0.1:8000/api/ready)
- Interactive API reference: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

The web interface checks the API through same-origin Next.js routes. Liveness stays available when PostgreSQL is down; readiness reports an error until a real database connection succeeds.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the web app and API together |
| `pnpm dev:worker` | Run the separate PostgreSQL-backed Remotion worker |
| `pnpm setup:api` | Install the locked Python environment |
| `pnpm setup:analyzer` | Build the restricted Playwright container |
| `pnpm test:analyzer` | Real isolated-browser tests against local fixture websites |
| `pnpm test:dna:e2e` | Live public-site capture through the UI, with reload and mobile checks |
| `pnpm db:up` | Start PostgreSQL and wait for its health check |
| `pnpm db:down` | Stop Compose services, retaining database data |
| `pnpm db:native:up` | Start an isolated workspace PostgreSQL instance without Docker |
| `pnpm db:native:down` | Stop the workspace PostgreSQL instance, retaining its data |
| `pnpm test` | Run application and shared-package unit tests |
| `pnpm lint` | Run JavaScript/TypeScript and Python linting |
| `pnpm typecheck` | Check strict TypeScript types |
| `pnpm build` | Build the Next.js application and Python package |
| `pnpm check` | Run the repository verification checks |
| `pnpm test:e2e` | Run the Playwright desktop/mobile acceptance tests |
| `VIDEO_RENDER_TESTS=1 pnpm test:video:e2e` | Encode and FFprobe a real 15-second MP4; exercise download and queue cancellation |
| `TIMELINE_RENDER_TESTS=1 pnpm exec playwright test tests/e2e/timeline.spec.ts` | Verify the editable timeline exports its exact shared composition |

Start PostgreSQL and both applications before the browser integration check. Install the browser once:

```bash
pnpm exec playwright install chromium
```

See [development instructions](docs/development.md) for individual services, production builds, configuration, and troubleshooting. See [architecture](docs/architecture.md) for request flow and phase boundaries.

The [website analysis guide](docs/website-analysis.md) documents the security model, limits, endpoints and schema. The [phase 3 report](docs/phase-3-report.md) records extraction verification. The [phase 2 implementation report](docs/phase-2-report.md) describes the studio pages, controls, persistence, validation, and limitations. The [phase 1 report](docs/phase-1-report.md) records the original foundation.

## Studio pages

| Route | Purpose |
| --- | --- |
| `/` | Recent account projects, project statistics, search, sort, and quick actions |
| `/create` | Validate a website reference or choose/paste a source file and create a saved project |
| `/analysis` | Inspect website captures and static source-code DNA alongside project brand settings |
| `/studio` | Shared Remotion preview/export, scene and layer tracks, inspector, keyframes, undo/redo, and autosave |
| `/generate` | DNA-driven Remotion Player, five templates and actual local MP4 export |
| `/director` | Grounded storyboard generation, editing, reorder, model provenance and live preview |
| `/queue` | Actual persisted local render jobs, progress and MP4 downloads |
| `/settings` | Device preferences, account project count and private media quota, and live local services |

The interface uses shadcn/ui source components, Radix accessibility primitives, and GSAP transitions. Accounts, project documents, revisions, DNA signatures, render history, and exports are persisted in PostgreSQL. Device preferences remain in browser storage. Images use owner-protected local storage; source archives are sent only to the local API for bounded static analysis, and repository code is never executed.

See the [AI Director guide](docs/ai-director.md) for grounded storyboards and optional local/API adapters.

See the [motion generation guide](docs/motion-generation.md) for video setup and CLI commands.

The [timeline editor guide](docs/timeline-editor.md) describes layer editing, frame controls, history, the versioned project document, and real local MP4 export. Existing browser drafts remain available for explicit import after sign-in. The [project management guide](docs/project-management.md) covers accounts, ownership, revisions, assets, storage limits, and retention.

The [video rendering guide](docs/video-rendering.md) documents the durable render queue, job lifecycle, output settings, cancellation, retries, storage, and verification. The [phase 7 report](docs/phase-7-report.md) records the production render acceptance results.

The [source-code DNA guide](docs/source-code-analysis.md) documents ZIP, GitHub, single-file, and trusted local-directory static analysis. Repository scripts and build tools are never executed.

The [phase 8 report](docs/phase-8-report.md) records source analyzer implementation, security limits, tests, and known limits.

Deferred: Redis queues, team workspaces, cloud authentication, payment processing, audio/video footage tracks, and public deployment. CSS motion properties are measured; JavaScript animation behavior is not fully analyzed. Local accounts are intended for development on one machine.

