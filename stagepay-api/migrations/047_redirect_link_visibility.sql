-- Opt-in per project — off by default. Once on, the customer pay page shows
-- this project's trackable-link click stats as soon as Stage 5 (Final Ad
-- Delivery) has an amount set, not only once it's paid/locked — locking
-- freezes the project, so waiting for that would throw away the window
-- where a creator can still point at live numbers to justify a higher
-- final price before either side commits.
ALTER TABLE redirect_links ADD COLUMN visible_to_customer INTEGER NOT NULL DEFAULT 0;
