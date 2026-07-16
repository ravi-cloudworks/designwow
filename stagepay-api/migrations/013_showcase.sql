-- Public portfolio page for a designer — same pattern as design-wow-api's
-- designer_showcase_items (design-wow itself is untouched; this is StagePay's
-- own copy, adapted to its schema). "Eligible" here means an item belonging
-- to a stage that's actually been locked (paid + approved by the customer)
-- with real uploaded output — the equivalent of design-wow's
-- "delivered_at IS NOT NULL" definition, just expressed via stage_locks
-- instead of a request's own delivered_at flag.
CREATE TABLE IF NOT EXISTS showcase_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  source_item_id TEXT, -- the StagePay item this came from; NULL for a standalone promo upload with no such origin
  caption TEXT,
  thumbnail_r2_key TEXT, -- client-captured JPEG frame for video previews (mobile browsers often can't render a <video> frame reliably)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_showcase_user ON showcase_items(user_id);
