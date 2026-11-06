CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash char(64) PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (owner_id, id)
);
CREATE INDEX IF NOT EXISTS projects_owner_updated_idx ON projects(owner_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS dna_analyses (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    schema_version text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dna_analyses_project_idx ON dna_analyses(owner_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assets (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
    byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
    sha256 char(64) NOT NULL,
    storage_key text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS assets_project_idx ON assets(owner_id, project_id, created_at);

CREATE TABLE IF NOT EXISTS storyboards (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    schema_version integer NOT NULL DEFAULT 1,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE,
    UNIQUE (owner_id, project_id)
);

CREATE TABLE IF NOT EXISTS scenes (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    scene_key text NOT NULL,
    position integer NOT NULL CHECK (position >= 0),
    document jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE,
    UNIQUE (owner_id, project_id, scene_key),
    UNIQUE (owner_id, project_id, position)
);

CREATE TABLE IF NOT EXISTS render_jobs (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL,
    owner_id uuid REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    input_hash text NOT NULL,
    request jsonb NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL,
    attempt integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    available_at timestamptz NOT NULL,
    worker_id text,
    lease_token uuid,
    lease_expires timestamptz,
    cancel_requested boolean NOT NULL DEFAULT false,
    UNIQUE(project_id, idempotency_key)
);
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS render_jobs_queue_idx ON render_jobs(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS render_jobs_owner_idx ON render_jobs(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS exports (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    render_job_id uuid NOT NULL UNIQUE,
    filename text NOT NULL,
    storage_key text NOT NULL,
    byte_size bigint NOT NULL CHECK (byte_size >= 0),
    width integer NOT NULL,
    height integer NOT NULL,
    fps integer NOT NULL,
    duration double precision NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS exports_owner_project_idx ON exports(owner_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dna_jobs (
    id uuid PRIMARY KEY,
    owner_id uuid REFERENCES users(id) ON DELETE CASCADE,
    project_id uuid,
    created_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    result jsonb,
    screenshot bytea
);
ALTER TABLE dna_jobs ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE dna_jobs ADD COLUMN IF NOT EXISTS project_id uuid;
CREATE INDEX IF NOT EXISTS dna_jobs_owner_project_idx ON dna_jobs(owner_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
