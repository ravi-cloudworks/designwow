-- Optional showcase cover image — a single account-level banner shown at
-- the top of the public showcase page, above the avatar/name block.
-- Nullable; no cover shows until a designer uploads one.
ALTER TABLE users ADD COLUMN showcase_cover_r2_key TEXT;
