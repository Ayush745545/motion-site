DELETE FROM dna_jobs d
WHERE d.owner_id IS NOT NULL AND d.project_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM projects p WHERE p.owner_id=d.owner_id AND p.id=d.project_id
  );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='dna_jobs_project_owner_fk'
    ) THEN
        ALTER TABLE dna_jobs
            ADD CONSTRAINT dna_jobs_project_owner_fk
            FOREIGN KEY (owner_id, project_id)
            REFERENCES projects(owner_id, id) ON DELETE CASCADE;
    END IF;
END $$;
