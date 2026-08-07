-- Trackable click-through links: one per project, redirects to the client's
-- own website (Instagram bio-link use case) and counts clicks — gives a
-- creator a real clickthrough number to negotiate future pricing with,
-- without depending on the client's own analytics/GA access.
CREATE TABLE IF NOT EXISTS redirect_links (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  destination_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Defaults to 30 days out at creation — long enough to cover a typical
  -- promo push, short enough that an old link doesn't keep pointing at a
  -- client page that's since changed. Renewable any time, not a hard cutoff.
  expires_at TEXT NOT NULL
);

-- Kept forever once logged, even past expiry — the click history IS the
-- product (a creator's proof point for the next pitch), so expiry only
-- stops new redirects, it never deletes past ones. Only removed if the
-- designer explicitly deletes the whole redirect link (cascades from
-- redirect_links), not on natural expiry.
CREATE TABLE IF NOT EXISTS redirect_clicks (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL REFERENCES redirect_links(token) ON DELETE CASCADE,
  clicked_at TEXT NOT NULL DEFAULT (datetime('now')),
  referrer TEXT,
  country TEXT -- ISO 3166-1 alpha-2, from Cloudflare's request.cf.country — no raw IP ever stored
);
CREATE INDEX IF NOT EXISTS idx_redirect_clicks_token ON redirect_clicks(token);
