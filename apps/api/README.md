# Motion DNA AI API

Python 3.12+ / FastAPI service. Run all commands below from the monorepo root.

```sh
uv sync --directory apps/api --locked
uv run --directory apps/api python -m motion_dna_api
uv run --directory apps/api pytest
uv run --directory apps/api ruff check .
uv run --directory apps/api ruff format --check .
uv build --directory apps/api
```

Configuration is loaded from the root `.env`, then overridden by process environment variables.
`CORS_ALLOWED_ORIGINS` must be an explicit JSON array of HTTP(S) origins. Credentials and wildcard
origins are deliberately unsupported. Database URLs are kept as secret values in settings.

- `GET /api/health`: liveness; independent of PostgreSQL availability.
- `GET /api/ready`: opens a bounded PostgreSQL connection and executes `SELECT 1`; returns
  HTTP 503 if the database cannot be reached.
- `GET /docs`: local interactive OpenAPI documentation.

Responses carry `X-Request-ID`. A valid caller-supplied ID of up to 64 safe characters is
preserved. Errors use `{ "error": { "code", "message", "request_id", "details" } }`.
Validation responses include field locations and error codes, never submitted input values.
Logs are JSON lines; database URLs, query strings, and exception messages are not logged.

Tests inject the database probe; they do not require a database or contact any AI provider.

