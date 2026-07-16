-- Append-only record of every payment actually confirmed — separate from
-- payment_link_stages, which is the CURRENT/active amount+paid state for
-- whatever's live right now and is meant to reset when a stage's content
-- resets (the designer has to charge again for redone work). This table
-- answers a different question: "how much have I actually earned on this
-- project, ever" — and must survive an earlier stage being unlocked and
-- everything after it being wiped, since money already collected for
-- completed work doesn't stop being earned just because the client later
-- asks for a revision. Only wiped by full project deletion (the deliberate
-- exception — deleting the whole project/client relationship does erase
-- its earnings history too), via the same ON DELETE CASCADE every other
-- per-project table already uses.
CREATE TABLE IF NOT EXISTS earnings_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  paid_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_earnings_log_project ON earnings_log(project_id);
