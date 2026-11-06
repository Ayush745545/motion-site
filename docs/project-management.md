# Local accounts and project storage

Motion DNA AI stores projects in PostgreSQL under a local account. Accounts are created on the development machine; this phase does not add cloud identity, payments, team sharing, or public deployment.

## Local setup

Start PostgreSQL and the API using the macOS steps in the [development guide](development.md). The API applies ordered SQL migrations at startup. The first account is created from `/login`; use a unique email and a password with at least 12 characters. Passwords use PBKDF2-SHA256. The browser receives a 14 day HttpOnly, SameSite=Lax session cookie; PostgreSQL stores only its SHA-256 digest.

```bash
pnpm db:up
pnpm dev
```

The product is local-first: the API and database listen on loopback during development. Do not expose them to a public network or reuse the sample database password outside local development.

## Persistence and ownership

`users` owns projects and sessions. Each project document contains its versioned timeline, scenes, website DNA, source DNA, storyboard, and settings. The server generates project UUIDs and uses the authenticated session for every owner predicate. Project saves use a monotonically increasing revision; a stale save receives HTTP 409. Full snapshots are retained for the latest 100 revisions per project and are readable through the versions API.

Images are stored under `storage/private-assets/<owner>/<project>/` with UUID filenames. The API returns no filesystem paths or public URLs. Asset reads, deletes, and links in project/render documents require the same authenticated owner and project. Uploads accept PNG, JPEG, or WebP up to 10 MB each. The 1 GB account quota counts saved image and MP4 bytes. A render that would exceed quota fails before its output is published. Removing an export from the queue releases its bytes while preserving render history.

Project deletion is a soft delete: the project leaves lists and all project, asset, DNA, render, and export access is blocked immediately. The purge command removes the project and associated private files after 30 days:

```bash
pnpm db:purge-deleted
```

Run this command on a schedule in deployments. This phase does not install a scheduler.

## API routes

All routes except health require the session where shown. Mutating requests check the configured explicit origin list and use per-process rate limits.

| Route | Behavior |
| --- | --- |
| `POST /api/auth/register` | Create a local user and session |
| `POST /api/auth/login` | Authenticate and issue a session |
| `GET /api/auth/session` | Read the current user |
| `POST /api/auth/logout` | Revoke the session |
| `GET /api/projects` | List the current user's active projects |
| `POST /api/projects` | Create a project; client IDs are ignored |
| `GET /api/projects/{id}` | Reopen one owned project |
| `PUT /api/projects/{id}` | Validate and save a new revision |
| `GET /api/projects/{id}/versions` | List retained revision metadata |
| `GET /api/projects/{id}/versions/{revision}` | Read an owned revision snapshot |
| `DELETE /api/projects/{id}` | Hide a project and schedule 30 day purge |
| `GET/POST /api/projects/{id}/assets` | List or upload private image assets |
| `GET/DELETE /api/projects/{id}/assets/{asset}` | Read or remove an owned image |
| `GET /api/account/usage` | Read project and private media usage |
| `GET /api/render/jobs` | List only the user's render history |
| `GET /api/render/jobs/{id}/download` | Stream an owned project's completed MP4 |
| `DELETE /api/render/jobs/{id}/export` | Remove an owned MP4 and free its storage |

The Next.js application proxies protected routes to FastAPI and forwards the HttpOnly cookie server-side. Browser code never receives a database URL, asset filesystem path, or storage key.

## Tests

Fast unit tests use mocked API and authentication boundaries. The owner-isolation acceptance test uses the real local PostgreSQL database, creates two accounts, and exercises create, save, reopen, revision history, private asset access, render/export access, quota accounting, export removal, and soft deletion:

```bash
PROJECT_DATABASE_TESTS=1 uv run --directory apps/api pytest tests/test_project_management_db.py -q
```

This writes temporary test rows to the configured local database and removes both test accounts at the end. The test MP4 is only a small access-control fixture; it does not invoke the renderer. To exercise a real account-owned render, start the local worker and use the gated acceptance test documented in [video rendering](video-rendering.md). Soft-deleted projects remain inaccessible immediately and are physically purged with their private files after 30 days.
