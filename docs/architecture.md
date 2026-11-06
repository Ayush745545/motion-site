# Architecture

Motion DNA AI is a pnpm monorepo with a separately packaged Python API. The browser renders the Next.js application. Next.js provides a narrow server-side proxy to FastAPI, and FastAPI owns infrastructure access.

```text
Browser :3000
    │ same-origin /api/health and /api/ready
    ▼
Next.js route handlers
    │ configured API_BASE_URL, timeout, validated response
    ▼
FastAPI :8000
    │ /api/ready executes SELECT 1
    ▼
PostgreSQL :5432
```

## Responsibilities

- `apps/web` owns navigation, visual presentation, live connection state, and the browser-facing health proxy. Backend addresses stay in server environment configuration.
- Account project documents and their immutable revisions live in PostgreSQL. The browser validates documents with Zod, while FastAPI validates each external save with Pydantic and derives ownership from the HttpOnly session. UI preferences remain in browser storage. Legacy browser drafts are kept for recovery and can be imported after sign-in.
- `apps/web/src/components/ui` holds editable shadcn/ui source components. GSAP handles scoped transitions with cleanup and reduced-motion support.
- `apps/api` owns local account/session management, owner-scoped project and asset APIs, Pydantic settings and response models, request IDs, JSON request/error logs, PostgreSQL readiness, website analysis, and render-job persistence.
- `packages/dna-schema` owns runtime schemas and their inferred TypeScript types. External responses are parsed at the web/API boundary.
- `packages/config` validates the web server's environment.
- `packages/ui` contains reusable presentation components.
- `infra` contains a local-only PostgreSQL service with a persistent named volume and health check. The optional native launcher in `scripts` owns a separate workspace data directory under `.cache/postgres` for Docker-free development.
- `workers/analyzer` runs a disposable Chromium process in a networkless, resource-limited Docker container. Browser requests cross a JSON-lines IPC broker that pins validated public DNS answers; the browser has no direct egress or host mounts.
- `apps/api/src/motion_dna_api/dna` owns URL policy, network brokering, job lifecycle, PostgreSQL persistence and bounded Pydantic contracts.
- `packages/motion-engine` owns the shared deterministic Remotion composition, local font assets, normalized motion parameters and MP4 renderer. `storage/renders` holds real job records and finished videos.
- `apps/api/migrations` versions the PostgreSQL schema; `project_versions` keeps the latest 100 document snapshots per project.
- `storage/private-assets` holds local image uploads outside the public web root. FastAPI serves them only after checking account and project ownership.

## Health contract

`GET /api/health` returns HTTP 200 when the FastAPI application is live:

```json
{
  "status": "ok",
  "service": "motion-dna-ai-api",
  "version": "0.1.0",
  "environment": "development"
}
```

This endpoint does not depend on the database. It allows operators and the interface to distinguish application availability from dependency readiness.

`GET /api/ready` executes `SELECT 1` against the configured PostgreSQL database. It returns HTTP 200 with `{"status":"ok","database":"connected"}` on success, or HTTP 503 with a structured error if the database cannot be reached. Tests inject the database check so unit tests do not depend on a running PostgreSQL instance. A live readiness call verifies the real connection.

The Next.js proxy validates successful upstream data before returning it. Invalid data, timeouts, and unavailable services become controlled errors rather than successful connection indicators.

## Configuration and errors

Both applications validate external configuration at runtime. The root `.env` is local-only; `.env.example` contains development defaults without real credentials. FastAPI allows only explicitly listed browser origins. Requests are assigned correlation IDs, and logs are structured JSON. API error responses remain generic for internal failures so credentials and exception details do not enter the browser.

Development services bind to loopback by default. The Compose credentials are deliberately public development defaults. Authentication is for local development accounts and is not a production identity system. Public deployment, secrets management, TLS, distributed rate limits, and deployment hardening remain later work.

## Future execution path

The manual studio autosaves account projects with version checks. `/generate` previews a shared Remotion composition using sample DNA or a completed backend analysis. A local worker claims render jobs from PostgreSQL. Progress comes from actual frame rendering/encoding callbacks. Completed jobs expose an owner-checked streamed MP4 download; users can remove an export while retaining its render history. See [motion generation](motion-generation.md) and [project management](project-management.md).

Website URL capture and DNA documents are implemented. The API admits up to two in-process jobs, with disposable isolated browser workers. PostgreSQL stores job state, result JSON and PNG captures. Interrupted jobs become retryable failures; this is not a distributed queue. Local Remotion/FFmpeg video rendering is implemented for the four-scene DNA composition. Redis scheduling remains later work. See [website analysis](website-analysis.md) for security design and operational limits.

## AI Director

The Director validates DNA/content and a creative brief, classifies the source, and assembles a grounded four-scene storyboard. Optional adapters return evidence-selection and timing plans; copy assembly remains local. The UI persists validated storyboards in project storage, and the shared Remotion component consumes their scene order, copy, presets and frame durations. See [AI Director](ai-director.md) for contracts and fallback behavior.
