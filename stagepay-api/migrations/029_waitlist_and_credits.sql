-- Waitlist gating + payment-credits monetization. New signups start
-- 'pending_profile' and must apply + be manually approved before they can
-- use the app; existing users are grandfathered straight to 'approved'
-- with a 50-credit founding-user balance instead of the standard 10 a
-- newly-approved applicant gets. A payment credit is spent the moment a
-- designer prices a stage that isn't already an open, unpaid receivable
-- (see pay.ts's PUT /payment-link/:stage) — never at payment-confirm time,
-- so a live customer transaction is never interrupted by a designer
-- running low mid-sale.
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'pending_profile'; -- 'pending_profile' | 'waitlisted' | 'approved'
ALTER TABLE users ADD COLUMN role TEXT; -- free-text from the waitlist form, e.g. 'ai_creator' | 'non_ai_creator' | 'agency' | 'other'
ALTER TABLE users ADD COLUMN instagram_url TEXT;
ALTER TABLE users ADD COLUMN youtube_url TEXT;
ALTER TABLE users ADD COLUMN ugc_description TEXT;
ALTER TABLE users ADD COLUMN applied_at TEXT;
ALTER TABLE users ADD COLUMN approved_at TEXT;
ALTER TABLE users ADD COLUMN free_credits_remaining INTEGER NOT NULL DEFAULT 0;

-- One-shot grandfather: every row that existed before this migration just
-- got defaulted to 'pending_profile' by the ALTER above, so this flips them
-- all to 'approved' with the founding-user grace balance in a single pass.
UPDATE users SET status = 'approved', free_credits_remaining = 50 WHERE status = 'pending_profile';

-- A pending/approved/rejected request to buy more credits — settled by the
-- designer paying the admin's own UPI ID directly (no gateway) and
-- submitting the UTR here for manual verification.
CREATE TABLE IF NOT EXISTS credit_purchase_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_size INTEGER NOT NULL,   -- 5 or 10
  amount_paise INTEGER NOT NULL, -- 24500 or 49000
  utr TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_credit_purchase_requests_user ON credit_purchase_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_purchase_requests_status ON credit_purchase_requests(status);
