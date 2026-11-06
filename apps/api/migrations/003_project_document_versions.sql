CREATE TABLE IF NOT EXISTS project_versions (
    project_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    revision integer NOT NULL CHECK (revision >= 1),
    schema_version integer NOT NULL CHECK (schema_version = 1),
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, revision),
    FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS project_versions_owner_idx
    ON project_versions(owner_id, project_id, revision DESC);

INSERT INTO project_versions(project_id, owner_id, revision, schema_version, document, created_at)
SELECT id, owner_id, revision, schema_version, document, updated_at
FROM projects
ON CONFLICT(project_id, revision) DO NOTHING;
