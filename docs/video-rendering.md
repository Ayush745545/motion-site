# Local video rendering

The web app submits a validated snapshot to FastAPI. FastAPI stores the job and request in PostgreSQL; a separate local Python worker claims one job at a time and invokes the fixed Remotion CLI. The browser player and the renderer use the same Remotion compositions and versioned timeline document.

## Export settings

- MP4 with H.264 and `yuv420p` encoding
- 720p or 1080p output
- 16:9 landscape or 9:16 portrait
- 24, 30, or 60 FPS
- Up to 21,600 output frames (15 minutes at 24 FPS)
- Maximum 512 MB output, 10-minute render wall time, one active render, and two attempts per job

For timeline documents whose input frame rate differs from the selected output rate, the shared export composition maps frame positions deterministically. A mismatched aspect ratio is fitted within the output canvas.

## API

The Next.js same-origin routes used by the interface are:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/motion/render` | Submit a snapshot and output settings |
| `GET` | `/api/motion/render/{job_id}?project_id={uuid}` | Read the project-scoped job state |
| `POST` | `/api/motion/render/{job_id}/cancel` | Cancel queued or active work |
| `POST` | `/api/motion/render/{job_id}/retry` | Retry a bounded, retryable failure or cancellation |
| `GET` | `/api/motion/render/{job_id}/download?project_id={uuid}` | Stream a completed MP4, including byte ranges |
| `GET` | `/api/render-jobs` | List recent local jobs for the queue page |

The FastAPI service also exposes the durable queue under `/api/render/jobs` with matching create, list, inspect, cancel, retry, and download operations.

Requests contain a UUID `project_id`, an `idempotency_key`, a `project_name`, a validated Remotion input snapshot, and an output object:

```json
{
  "project_id": "00000000-0000-4000-8000-000000000001",
  "project_name": "Studio launch",
  "idempotency_key": "client-generated-request-key",
  "input": { "document": "...validated project document..." },
  "output": { "quality": "720p", "aspect_ratio": "9:16", "fps": 24 }
}
```

The request key is unique per project. Repeating the same key and content returns the existing job; reusing that key with different content returns a conflict. The Next.js server forwards the HttpOnly session cookie to FastAPI. FastAPI derives the owner from that session, verifies that the project is active and owned by that account, and scopes inspection, cancellation, retry, quota usage, export removal, and download to the same owner.

## Job lifecycle

```text
queued → running → completed
                 ↘ retrying → running → completed / failed
queued → cancelled
running → cancelling → cancelled
```

Progress is written from Remotion's render callbacks and persisted by the worker heartbeat. The UI polls the stored state and shows the last real progress update if a connection is temporarily unavailable. The worker independently probes the produced MP4 with FFprobe before it publishes the file and marks the job complete.

Cancellation sets a database flag; the active worker observes it, terminates the renderer process group, records the cancellation, and removes temporary files. A completed job cannot be cancelled. Retryable renderer failures receive at most one automatic retry; user retries are also capped at two attempts total. Invalid project data and invalid output are terminal and require a corrected new export.

## Local files and runtime

The PostgreSQL table stores request snapshots, status, progress, attempt data, error codes, exit codes, and verified output metadata. Files are grouped by generated job UUID:

```text
storage/renders/{job_uuid}/
├── input.json
├── attempt-1.log
├── metadata.json
└── video.mp4
```

Temporary render files are isolated in a job-local directory and removed after success, failure, cancellation, or interruption. Logs are capped at 2 MB. Filesystem output is staged and moved into place only when the PostgreSQL lease is still valid.

Start PostgreSQL before the web, API, and worker processes. `pnpm dev` starts all three application processes; the worker needs the repository's local Node.js/Remotion dependencies and FFmpeg/FFprobe on `PATH`. Development instructions and health checks are in [development.md](development.md).

## Verification

PostgreSQL-backed project and queue ownership checks:

```bash
PROJECT_DATABASE_TESTS=1 uv run --directory apps/api pytest tests/test_project_management_db.py -q
RENDER_DATABASE_TESTS=1 uv run --directory apps/api pytest tests/test_renders.py -q
```

The API and worker run locally without a paid video service. Local account authentication and project ownership are enforced. Cloud identity, Redis scheduling, parallel render execution, cloud storage, and remote render machines remain outside this phase.

To verify a real account-owned render, start PostgreSQL and one worker in separate terminals, then run:

```bash
PROJECT_RENDER_TESTS=1 uv run --directory apps/api pytest tests/test_account_render_acceptance.py -q
```

The acceptance test creates a temporary account and project, saves an edit, submits a 15-second 720p H.264 render at 24 FPS, checks all 360 decoded frames and output metadata with FFprobe, downloads the MP4, confirms project deletion blocks access, and removes the temporary account and render files. It may take several minutes and requires Node.js, Remotion, FFprobe, and a running local worker.
