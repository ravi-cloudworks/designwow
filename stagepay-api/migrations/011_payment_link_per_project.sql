DROP TABLE IF EXISTS payment_link_stages;
DROP TABLE IF EXISTS payment_links;

CREATE TABLE payment_links (
  token TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payment_link_stages (
  token TEXT NOT NULL REFERENCES payment_links(token) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (token, stage)
);
