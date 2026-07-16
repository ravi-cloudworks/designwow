ALTER TABLE users ADD COLUMN upi_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS payment_links (
  token TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, stage)
);
