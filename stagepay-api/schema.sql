-- StagePay — independent schema, no relation to design-wow-api's ugc-queue-db.
-- Reuses the same Google OAuth *client* as design-wow-api, but its own,
-- separate users/sessions table — a designer's StagePay account is not the
-- same account/session as their design-wow-api one.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  upi_id TEXT NOT NULL DEFAULT '', -- one UPI VPA per designer, used on every payment link's QR
  goal_amount_paise INTEGER NOT NULL DEFAULT 0, -- Goal Tracker: how much they want to earn in the rolling 3-month window starting at goal_set_at
  goal_set_at TEXT,
  stage_prices_paise TEXT NOT NULL DEFAULT '{}', -- Goal Tracker manual allocation: {"2":.., "3":.., "4":.., "5":..} — durable, survives across goals
  stage_target_counts TEXT NOT NULL DEFAULT '{}', -- Goal Tracker manual allocation: target count per stage for the CURRENT goal — reset whenever a new goal is set
  showcase_slug TEXT, -- optional custom handle for a nicer /showcase/{slug} URL — nullable, falls back to the raw id
  contact_link TEXT, -- optional public contact link (Instagram/LinkedIn/site) shown on the showcase page — an alternative to publishing a personal phone number
  status TEXT NOT NULL DEFAULT 'pending_profile', -- 'pending_profile' | 'waitlisted' | 'approved' — gates access until manually approved
  role TEXT, -- from the waitlist form: 'ai_creator' | 'non_ai_creator' | 'agency' | 'other'
  instagram_url TEXT,
  youtube_url TEXT,
  ugc_description TEXT,
  applied_at TEXT,
  approved_at TEXT,
  free_credits_remaining INTEGER NOT NULL DEFAULT 0, -- payment credits: spent when pricing a stage that isn't already an open, unpaid receivable
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_showcase_slug ON users(showcase_slug);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'agent'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

-- Stage 1 (Creative Brief) is never versioned — it's the designer's own raw
-- input, one row per project, edited in place.
CREATE TABLE IF NOT EXISTS stage1_brief (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  product TEXT NOT NULL DEFAULT '',
  product_description TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  video_style TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',               -- Comedic/Warm/Dramatic/Aspirational/Playful — a brand-level creative decision, not a per-item Stage 2 setting
  platform TEXT NOT NULL DEFAULT '',
  duration INTEGER NOT NULL DEFAULT 30,
  language TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  storyboard TEXT NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  brand_color_primary TEXT,
  brand_color_secondary TEXT,
  brand_color_accent TEXT,
  logo_media TEXT NOT NULL DEFAULT '{}',      -- JSON {key, fileName} — real R2-backed file
  product_photos TEXT NOT NULL DEFAULT '[]',  -- JSON array of {key, fileName}
  locked INTEGER NOT NULL DEFAULT 0,          -- 1 once "validated with customer" — brief becomes read-only
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every stage 2-6 "card" is an item: Story (stage 2), Character/Property/Sound
-- (stage 3), a Scene (stage 4), its paired shot list (stage 5) and final movie
-- clip (stage 6) — both with parent_item_id pointing at their Scene. Each
-- item holds exactly one version — versioning across 3 drafts turned out to
-- be complexity without a matching benefit once the flow is "generate once
-- externally, attach the result, ship it."
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,           -- 2,3,4,5,6
  item_key TEXT NOT NULL,           -- 'story' | 'character' | 'property' | 'sound' |
                                     -- 'scene' | 'shotlist' | 'movie'
  parent_item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_project ON items(project_id);
CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_item_id);

CREATE TABLE IF NOT EXISTS item_versions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1, -- always 1 — column kept so nothing else has to change shape
  fields TEXT NOT NULL DEFAULT '{}', -- JSON blob; shape depends on item_key (this item type's Setup fields)
  prompt TEXT NOT NULL DEFAULT '',
  media_files TEXT NOT NULL DEFAULT '[]', -- JSON array of {key, fileName, kind}, real R2-backed files
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, version_number)
);

-- One row per stage (2-5; stage 1 has no AI generation, so no row). config is
-- the full JSON blob: universalStyle, assemblyOrder, and per-item-key content
-- (Gemini-facing fieldsSchema/geminiInstruction/autoPopulate) + outputInstructions
-- (Google-Flow-facing master-sheet templates). Editing a row here changes what
-- the app sends to Gemini and what it composes for Flow — no redeploy needed.
CREATE TABLE IF NOT EXISTS stage_prompts (
  stage INTEGER PRIMARY KEY,
  config TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_item_versions_item ON item_versions(item_id);

-- One link per PROJECT (not per stage) — created automatically the moment
-- the project itself is created, so it's always ready to share; nothing to
-- "create" later. No payment gateway: this is the same self-attested UPI QR
-- pattern design-wow-pages already uses (a `upi://pay?...` URI rendered as a
-- QR client-side), just with a public, token-based, no-login page in front
-- of it (design-wow-pages never needed that because its customers are
-- already logged in).
CREATE TABLE IF NOT EXISTS payment_links (
  token TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-stage amount/paid tracking hangs off the one project-wide link — a row
-- only exists once the designer has actually set an amount for that stage,
-- which is also how the public ledger page knows which stages to show.
CREATE TABLE IF NOT EXISTS payment_link_stages (
  token TEXT NOT NULL REFERENCES payment_links(token) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,     -- self-attested — by either the customer's own click or the designer's "confirm received", never verified
  paid_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (token, stage)
);

-- Per-stage validation checkpoint, same philosophy as stage1_brief.locked:
-- once validated with the customer, that stage is read-only. Unlocking is
-- destructive on purpose (wipes every stage AFTER this one, and their
-- payment records) rather than tracking partial staleness — consistent with
-- every other lock/unlock decision in this project.
CREATE TABLE IF NOT EXISTS stage_locks (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  PRIMARY KEY (project_id, stage)
);

-- Public portfolio page for a designer — ported from design-wow-api's
-- designer_showcase_items pattern (design-wow itself untouched). "Eligible"
-- means an item belonging to a locked (paid + approved) stage with real
-- uploaded output — StagePay's equivalent of design-wow's
-- "delivered_at IS NOT NULL", expressed via stage_locks instead.
CREATE TABLE IF NOT EXISTS showcase_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  source_item_id TEXT, -- the StagePay item this came from; NULL for a standalone promo upload
  caption TEXT,
  thumbnail_r2_key TEXT, -- client-captured JPEG frame for video previews
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_showcase_user ON showcase_items(user_id);

-- Append-only record of every payment actually confirmed — separate from
-- payment_link_stages (the CURRENT/active amount+paid state, which resets
-- when a stage's content resets). This survives an earlier stage being
-- unlocked and everything after it wiped — money already collected for
-- completed work doesn't stop being earned just because of a later
-- revision. Only wiped by full project deletion.
CREATE TABLE IF NOT EXISTS earnings_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  paid_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_earnings_log_project ON earnings_log(project_id);

-- A pending/approved/rejected request to buy more payment credits — settled
-- by the designer paying the admin's own UPI ID directly (no gateway) and
-- submitting the UTR here for manual verification via the admin queue.
CREATE TABLE IF NOT EXISTS credit_purchase_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_size INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  utr TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_credit_purchase_requests_user ON credit_purchase_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_purchase_requests_status ON credit_purchase_requests(status);
