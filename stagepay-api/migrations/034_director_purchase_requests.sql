-- Same manual UTR + admin-approval pattern as credit_purchase_requests —
-- no payment gateway yet, so a designer pays the admin's own UPI directly
-- and submits the UTR here for manual verification. months is a duration
-- tier (1/3/6/12), not a quantity — approving one adds that many months to
-- director_access_until (extending from the existing date if it's still in
-- the future, e.g. an early renewal, rather than from today, so no already-
-- paid time is ever lost) and sets has_director_access = 1.
CREATE TABLE IF NOT EXISTS director_purchase_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  months INTEGER NOT NULL,       -- 1, 3, 6, or 12
  amount_paise INTEGER NOT NULL, -- 29900, 83700, 149400, or 238800 (discounted tiers)
  utr TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_director_purchase_requests_user ON director_purchase_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_director_purchase_requests_status ON director_purchase_requests(status);
