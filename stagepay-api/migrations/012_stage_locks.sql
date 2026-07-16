CREATE TABLE IF NOT EXISTS stage_locks (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  PRIMARY KEY (project_id, stage)
);
