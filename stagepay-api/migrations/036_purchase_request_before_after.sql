-- Permanent before/after snapshots, captured once at approval time and
-- never touched again — the account's own current balance/expiry drifts
-- with later renewals/spending, so showing "your current balance" next to
-- an old historical request would be misleading once anything else has
-- happened since. These columns make each request's own history
-- unambiguous regardless of what's happened to the account afterward.
ALTER TABLE credit_purchase_requests ADD COLUMN previous_credits INTEGER;
ALTER TABLE credit_purchase_requests ADD COLUMN new_credits INTEGER;

ALTER TABLE director_purchase_requests ADD COLUMN previous_access_until TEXT;
ALTER TABLE director_purchase_requests ADD COLUMN new_access_until TEXT;
