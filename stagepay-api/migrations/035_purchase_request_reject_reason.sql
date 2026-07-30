-- Rejecting a purchase request (credits or Director) previously stored no
-- reason at all — the designer just saw "rejected" with no way to know why
-- (e.g. a wrong/unmatched UTR), so they'd have no idea what to fix before
-- resubmitting. Optional, shown alongside the rejected status in their own
-- "Your requests" list.
ALTER TABLE credit_purchase_requests ADD COLUMN reject_reason TEXT;
ALTER TABLE director_purchase_requests ADD COLUMN reject_reason TEXT;
