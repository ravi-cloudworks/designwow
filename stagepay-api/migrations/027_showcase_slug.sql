-- A short, designer-chosen handle (letters/numbers/hyphens) for a nicer
-- public showcase URL (/showcase/{slug} instead of /showcase/{uuid}).
-- Nullable — a designer who never sets one just keeps using their raw user
-- id, which stays valid forever either way (see showcase.ts's public route).
ALTER TABLE users ADD COLUMN showcase_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_showcase_slug ON users(showcase_slug);
