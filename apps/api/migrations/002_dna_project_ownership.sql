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
