-- One active goal per designer at a time — "how much do I want to earn in
-- the next 3 months, starting from when I set this". goal_set_at anchors
-- the rolling 3-month window progress is measured against; re-setting the
-- goal (moving the slider) resets the window to start from that moment.
ALTER TABLE users ADD COLUMN goal_amount_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN goal_set_at TEXT;
