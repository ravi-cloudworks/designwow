-- Goal Tracker's manual per-stage allocation tool: a designer's own typical
-- price per stage (durable, survives across goals) and their target count
-- per stage for the CURRENT goal (reset whenever a new goal is set — see
-- earnings.ts). Stored as small JSON blobs keyed by stage number ("2".."5")
-- since there are only 4 real paid stages; not worth a separate table.
ALTER TABLE users ADD COLUMN stage_prices_paise TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN stage_target_counts TEXT NOT NULL DEFAULT '{}';
