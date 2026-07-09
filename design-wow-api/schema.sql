-- ===================================================================
-- UGC Video Queue — D1 schema
-- Two roles (customer, designer), flat-fee subscriptions, one active
-- request per customer, SLA timer with clarification pauses.
-- ===================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------
-- Users & profiles
-- ---------------------------------------------------------------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL CHECK (length(name) <= 100),
  avatar_url    TEXT,
  role          TEXT NOT NULL CHECK (role IN ('customer','designer')),
  google_id     TEXT UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE designer_profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio             TEXT CHECK (length(bio) <= 1000),
  specialty_tags  TEXT,                 -- JSON array, e.g. '["Testimonials","TikTok-native"]'
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  -- E.164-ish (with country code), shown as a tap-to-call CTA on the public
  -- showcase page — a direct phone call is a much stronger trust signal than
  -- email for freelancers in the Indian market, per designer feedback.
  phone           TEXT
);

-- A designer's saved UPI IDs (e.g. personal vs. a spouse's account) — picked
-- from when requesting payment for a delivery. We never touch the money
-- ourselves; this is purely so the QR/link generator has a payee to point at.
CREATE TABLE designer_payment_accounts (
  id          TEXT PRIMARY KEY,
  designer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL CHECK (length(label) <= 50),
  upi_id      TEXT NOT NULL CHECK (length(upi_id) <= 100),
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_payment_accounts_designer ON designer_payment_accounts(designer_id);

-- Designer-curated public portfolio — an opt-in pick of their own past
-- deliverables (or a standalone promo upload, e.g. a demo reel that was never
-- part of any client delivery) to show on their public showcase page
-- (/d/:id). File info is denormalized here (not just a foreign key) so this
-- table is self-sufficient to serve from — a promo upload has no
-- corresponding request_assets row at all. asset_id is kept, when present,
-- purely as provenance ("this came from request X"); it's NULL for a
-- standalone promo upload. Opt-in per item deliberately: delivered work
-- belongs to a paying customer's brand, so nothing is shown publicly unless
-- the designer explicitly chooses it.
CREATE TABLE designer_showcase_items (
  id                TEXT PRIMARY KEY,
  designer_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_key            TEXT NOT NULL,
  file_name         TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  asset_id          TEXT REFERENCES request_assets(id),
  caption           TEXT,
  -- A generated JPEG frame for video items — mobile browsers frequently
  -- won't render a <video preload="metadata"> frame at all (esp. on
  -- cellular/data-saver), so a real stored thumbnail is the only reliable
  -- way to show a preview. Always exclusively owned by this row (unlike
  -- r2_key, which may be shared with the original delivery) — deleting the
  -- item always deletes its thumbnail from R2.
  thumbnail_r2_key  TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_showcase_designer ON designer_showcase_items(designer_id, created_at);

-- A designer's reusable presets for the structured brief picker (avatar
-- style, mood/visual style, music style — the categories that genuinely
-- transfer across customers, unlike a background/setting which is tied to
-- one specific brand). industry_tags is a JSON array; NULL/empty means
-- "universal" — shown regardless of the customer's stated industry. Tags
-- are multi-select (one asset can serve several industries) and share the
-- same taxonomy used to sort designers by specialty match.
CREATE TABLE designer_asset_library (
  id            TEXT PRIMARY KEY,
  designer_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      TEXT NOT NULL CHECK (category IN ('avatar','mood','music')),
  label         TEXT NOT NULL CHECK (length(label) <= 100),
  r2_key        TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  industry_tags TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_asset_library_designer ON designer_asset_library(designer_id, category);

CREATE TABLE customer_profiles (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferred_designer_id   TEXT REFERENCES users(id)
);

-- ---------------------------------------------------------------
-- Subscriptions (flat monthly fee, 2 tiers)
-- ---------------------------------------------------------------
CREATE TABLE subscriptions (
  id                    TEXT PRIMARY KEY,
  customer_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_tier             TEXT NOT NULL CHECK (plan_tier IN ('standard','priority')),
  sla_hours             INTEGER NOT NULL CHECK (
                            (plan_tier = 'standard' AND sla_hours = 78) OR
                            (plan_tier = 'priority' AND sla_hours = 48)
                        ),
  amount_paise          INTEGER NOT NULL CHECK (
                            (plan_tier = 'standard' AND amount_paise = 299900) OR
                            (plan_tier = 'priority' AND amount_paise = 699900)
                        ),
  status                TEXT NOT NULL CHECK (status IN ('active','paused','cancelled')) DEFAULT 'active',
  dodo_customer_id      TEXT,
  dodo_subscription_id  TEXT,
  started_at            TEXT NOT NULL DEFAULT (datetime('now')),
  next_billing_at       TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_subscriptions_customer ON subscriptions(customer_id);

-- ---------------------------------------------------------------
-- Requests (the core object — one row per submission, revisions
-- link back via parent_request_id with their own fresh SLA window)
-- ---------------------------------------------------------------
CREATE TABLE requests (
  id                    TEXT PRIMARY KEY,
  customer_id           TEXT NOT NULL REFERENCES users(id),
  designer_id           TEXT NOT NULL REFERENCES users(id),
  subscription_id       TEXT NOT NULL REFERENCES subscriptions(id),
  parent_request_id     TEXT REFERENCES requests(id),
  is_revision           INTEGER NOT NULL DEFAULT 0 CHECK (is_revision IN (0,1)),

  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'queued', 'in_progress', 'needs_info',
    'delivered', 'approved', 'revision_requested'
  )),

  -- brief: the basics
  product_name          TEXT NOT NULL CHECK (length(product_name) <= 100),
  product_description   TEXT NOT NULL CHECK (length(product_description) <= 1000),
  goal                  TEXT NOT NULL CHECK (goal IN ('conversions','brand_awareness','ugc_testimonial','organic_social')),
  platform              TEXT NOT NULL CHECK (platform IN ('tiktok','instagram_reels','youtube_shorts','other')),
  video_length_sec      INTEGER NOT NULL CHECK (video_length_sec IN (15,30,60,0)),  -- 0 = custom
  video_length_note     TEXT CHECK (length(video_length_note) <= 100),             -- used when custom
  variants_count        INTEGER NOT NULL DEFAULT 1 CHECK (variants_count BETWEEN 1 AND 5),

  -- brief: story & characters
  characters_mode       TEXT NOT NULL CHECK (characters_mode IN ('own_footage','ai_avatar','need_talent')),
  characters_desc       TEXT CHECK (length(characters_desc) <= 500),
  story_direction        TEXT NOT NULL CHECK (length(story_direction) <= 2000),
  tone                  TEXT CHECK (tone IN ('funny','emotional','energetic','professional')),
  cta                   TEXT NOT NULL CHECK (length(cta) <= 200),

  -- brief: brand & assets
  color_preferences     TEXT CHECK (length(color_preferences) <= 200),
  music_mode            TEXT NOT NULL DEFAULT 'pick_for_me' CHECK (music_mode IN ('pick_for_me','customer_provided','describe_style')),
  music_note            TEXT CHECK (length(music_note) <= 300),

  -- brief: misc
  restrictions          TEXT CHECK (length(restrictions) <= 1000),
  additional_notes      TEXT CHECK (length(additional_notes) <= 1000),

  -- brief: structured picker (phase 1 of the AI-video pipeline) — not a DB
  -- CHECK on the *_choice columns since their allowed values evolve with
  -- each designer's library, not a fixed enum. industry drives both which
  -- designers get recommended and which of a chosen designer's assets show.
  -- Each *_choice is a JSON blob: {source:'library'|'upload', assetId, label}.
  industry              TEXT,
  avatar_choice         TEXT,
  mood_choice           TEXT,
  music_choice          TEXT,
  script_style          TEXT,
  cta_style             TEXT,

  -- timer
  sla_hours             INTEGER NOT NULL,          -- copied from subscription at submit time
  submitted_at          TEXT,
  started_at            TEXT,
  paused_at             TEXT,                      -- non-null while status = needs_info
  total_paused_seconds  INTEGER NOT NULL DEFAULT 0,
  sla_deadline          TEXT,                       -- submitted_at + sla_hours + total_paused_seconds
  delivered_at          TEXT,
  approved_at           TEXT,

  -- Captured on approve — 'good' | 'needs_improvement' | 'bad', validated in
  -- app code (not a DB CHECK, to keep ALTER TABLE additive and simple).
  -- Rolled up into designer stats; the plan is to use it as a future
  -- search/filter signal when customers are picking a designer.
  feedback_rating       TEXT,
  feedback_note         TEXT,

  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Enforces the "one active request at a time" rule at the DB level.
-- A request is "active" whenever it's neither a draft nor already approved.
CREATE UNIQUE INDEX idx_one_active_request_per_customer
  ON requests(customer_id)
  WHERE status NOT IN ('draft','approved');

CREATE INDEX idx_requests_designer_status ON requests(designer_id, status);
CREATE INDEX idx_requests_customer ON requests(customer_id, status);
CREATE INDEX idx_requests_sla_deadline ON requests(sla_deadline);

-- ---------------------------------------------------------------
-- Assets (R2-backed: logo, product files, references, delivered output)
-- Convention for r2_key:
--   customer uploads -> uploads/{customer_id}/{request_id}/{type}/{filename}
--   designer output  -> deliveries/{request_id}/{filename}
-- ---------------------------------------------------------------
CREATE TABLE request_assets (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('logo','product_file','reference_file','output','clarification')),
  r2_key        TEXT NOT NULL,
  file_name     TEXT NOT NULL CHECK (length(file_name) <= 255),
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  comment_id    TEXT REFERENCES request_comments(id),  -- deprecated: superseded by request_comment_assets (many-to-many)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_assets_request ON request_assets(request_id, type);

-- App-enforced size ceilings per type (not a DB constraint — validate
-- at presigned-URL issuance time): logo 10MB, product_file/reference_file
-- 50MB each (max 5 of each per request), output 500MB.

-- ---------------------------------------------------------------
-- Reference URLs (max 5 per request, enforced at app level)
-- ---------------------------------------------------------------
CREATE TABLE request_links (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  url           TEXT NOT NULL CHECK (length(url) <= 500),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_links_request ON request_links(request_id);

-- ---------------------------------------------------------------
-- Clarification thread ("Needs Info" comments)
-- ---------------------------------------------------------------
CREATE TABLE request_comments (
  id                    TEXT PRIMARY KEY,
  request_id            TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author_id             TEXT NOT NULL REFERENCES users(id),
  message               TEXT NOT NULL CHECK (length(message) <= 1000),
  -- Set together when this message is a payment request — the QR/UPI link is
  -- generated client-side from these, never processed as a real payment by us.
  payment_amount_paise  INTEGER,
  payment_upi_id        TEXT,
  payment_upi_label     TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_comments_request ON request_comments(request_id);

-- Many-to-many: lets a message reference an asset (either a freshly-uploaded
-- 'clarification' file or an already-existing brief upload, e.g. re-pointing
-- at the original logo) without duplicating storage or limiting an asset to
-- a single owning comment.
CREATE TABLE request_comment_assets (
  comment_id TEXT NOT NULL REFERENCES request_comments(id) ON DELETE CASCADE,
  asset_id   TEXT NOT NULL REFERENCES request_assets(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, asset_id)
);

-- ---------------------------------------------------------------
-- Designer daily log (internal productivity/history, not customer-facing)
-- ---------------------------------------------------------------
CREATE TABLE designer_daily_logs (
  designer_id         TEXT NOT NULL REFERENCES users(id),
  log_date            TEXT NOT NULL,   -- 'YYYY-MM-DD'
  requests_completed  INTEGER NOT NULL DEFAULT 0,
  hours_logged        REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (designer_id, log_date)
);

-- ---------------------------------------------------------------
-- Notifications (in-app only, per current decision — no email)
-- ---------------------------------------------------------------
CREATE TABLE notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN (
                    'status_change','needs_info','delivered','revision_requested','approved'
                )),
  message       TEXT NOT NULL CHECK (length(message) <= 300),
  link          TEXT,
  read          INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read);

-- ---------------------------------------------------------------
-- Homepage waitlist — no self-serve signup yet (no payment collection,
-- no self-serve designer onboarding), so "Get Started" just captures a lead
-- here. Reviewed and onboarded manually (subscription activated / designer
-- promoted directly in the DB), same pattern used for every test account
-- this project has had so far.
-- ---------------------------------------------------------------
CREATE TABLE waitlist_signups (
  id          TEXT PRIMARY KEY,
  role        TEXT NOT NULL CHECK (role IN ('customer','designer')),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
