-- Caches the last successful Gemini auto-populate response per (project,
-- purpose) — "purpose" is the sorted, joined list of fields requested
-- (e.g. "backgrounds,characters,properties,sounds" for Stage 3's sync,
-- "scenes" for Stage 4's) — so repeated clicks of the same Sync button
-- return the same result instead of paying for another Gemini call.
-- Invalidated by deleting the row(s) for a project, not by comparing text:
-- once Stage 1 is locked its storyboard is immutable in the UI, so the
-- only way the source text can actually change is via unlock-brief, which
-- already deletes this project's rows in the same cascade as items/
-- stage_locks/payment_link_stages (see projects.ts's /unlock-brief route).
CREATE TABLE IF NOT EXISTS auto_populate_cache (
  project_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, purpose)
);
