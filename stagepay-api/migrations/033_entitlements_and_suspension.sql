-- Per-user entitlements (StagePay-only vs StagePay+Director addon) and an
-- immediate misuse kill switch, independent of the waitlist `status` column.
--
-- has_director_access: Director is an addon, not a standalone product — this
-- just flags whether the extension's Setup/Generate features are unlocked
-- for a given user (checked via GET /auth/me's computed hasDirectorAccess).
--
-- stagepay_access_until / director_access_until: optional, nullable expiry
-- dates (plain 'YYYY-MM-DD', compared against date('now')) — a manual stand-in
-- for real subscription billing until that's built. Mirrors the existing
-- free_credits_remaining gate exactly: past stagepay_access_until pauses the
-- public showcase page and blocks pricing a NEW stage (see showcase.ts /
-- pay.ts), but an already-live payment link keeps working — a designer's
-- existing customer is never interrupted mid-sale just because a date
-- passed, same reasoning as running out of credits. director_access_until
-- only affects the extension's own Director features, nothing server-side
-- beyond what GET /auth/me reports.
--
-- suspended: a deliberately blunter, separate kill switch for misuse —
-- unlike the graceful expiry above, this blocks the account's own dashboard/
-- API access immediately (see index.ts's global check) AND immediately pauses
-- the public showcase page and payment link (see showcase.ts / pay.ts),
-- including already-live links — the one case where "don't interrupt an
-- existing customer" is deliberately NOT honored, since misuse is exactly
-- the scenario where those public pages should stop working right away.
ALTER TABLE users ADD COLUMN has_director_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN stagepay_access_until TEXT;
ALTER TABLE users ADD COLUMN director_access_until TEXT;
ALTER TABLE users ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0;
