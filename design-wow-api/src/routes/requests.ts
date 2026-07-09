import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/auth';

const requests = new Hono<{ Bindings: Bindings }>();

requests.get('/', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const user = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?')
    .bind(userId)
    .first<{ role: string }>();
  if (!user) return c.json({ error: 'unauthenticated' }, 401);

  const { results } = user.role === 'designer'
    ? await c.env.DB.prepare(
        `SELECT r.*, u.name AS customer_name, s.plan_tier,
                (SELECT message FROM request_comments c
                 WHERE c.request_id = r.id ORDER BY c.created_at DESC LIMIT 1) AS latest_comment
         FROM requests r
         JOIN users u ON u.id = r.customer_id
         JOIN subscriptions s ON s.id = r.subscription_id
         WHERE r.designer_id = ?
         ORDER BY r.sla_deadline ASC`
      ).bind(userId).all()
    : await c.env.DB.prepare(
        `SELECT r.*, du.name AS designer_name, s.plan_tier
         FROM requests r
         JOIN users du ON du.id = r.designer_id
         JOIN subscriptions s ON s.id = r.subscription_id
         WHERE r.customer_id = ?
         ORDER BY r.created_at DESC`
      ).bind(userId).all();

  return c.json({ requests: results });
});

requests.get('/:id', async (c) => {
  const id = c.req.param('id');
  const request = await c.env.DB.prepare(
    `SELECT r.*,
            du.name AS designer_name, du.avatar_url AS designer_avatar_url,
            cu.name AS customer_name, cu.avatar_url AS customer_avatar_url,
            s.plan_tier, s.started_at AS subscription_started_at
     FROM requests r
     JOIN users du ON du.id = r.designer_id
     JOIN users cu ON cu.id = r.customer_id
     JOIN subscriptions s ON s.id = r.subscription_id
     WHERE r.id = ?`
  ).bind(id).first();
  if (!request) return c.json({ error: 'not_found' }, 404);

  const [{ results: assets }, { results: links }, { results: comments }, { results: commentAssets }] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM request_assets WHERE request_id = ?').bind(id).all(),
    c.env.DB.prepare('SELECT * FROM request_links WHERE request_id = ?').bind(id).all(),
    c.env.DB.prepare(
      `SELECT c.*, u.name AS author_name, u.role AS author_role
       FROM request_comments c JOIN users u ON u.id = c.author_id
       WHERE c.request_id = ? ORDER BY c.created_at ASC`
    ).bind(id).all(),
    c.env.DB.prepare(
      `SELECT ca.comment_id, ca.asset_id
       FROM request_comment_assets ca
       JOIN request_comments c ON c.id = ca.comment_id
       WHERE c.request_id = ?`
    ).bind(id).all(),
  ]);

  return c.json({ request, assets, links, comments, commentAssets });
});

type RequestBody = {
  designerId: string;
  subscriptionId: string;
  slaHours: number;
  productName: string;
  productDescription: string;
  goal: string;
  platform: string;
  videoLengthSec: number;
  videoLengthNote?: string | null;
  variantsCount?: number;
  charactersMode: string;
  charactersDesc?: string | null;
  storyDirection: string;
  tone?: string | null;
  cta: string;
  colorPreferences?: string | null;
  musicMode?: string;
  musicNote?: string | null;
  restrictions?: string | null;
  additionalNotes?: string | null;
  industry?: string | null;
  avatarChoice?: string | null;
  avatarBackupChoice?: string | null;
  moodChoice?: string | null;
  musicChoice?: string | null;
  musicBackupChoice?: string | null;
  backgroundChoice?: string | null;
  backgroundBackupChoice?: string | null;
  scriptStyle?: string | null;
  ctaStyle?: string | null;
  targetAudience?: string | null;
  aspectRatio?: string | null;
  language?: string | null;
  voiceType?: string | null;
  subtitles?: string | null;
  brandColorPrimary?: string | null;
  brandColorSecondary?: string | null;
  termsConfirmed?: boolean;
};

requests.post('/', async (c) => {
  // Creates a draft. TODO: validate fields against the length/enum limits in schema.sql
  // (this is currently enforced only by the DB CHECK constraints).
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req.json<RequestBody>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO requests (
       id, customer_id, designer_id, subscription_id, status,
       product_name, product_description, goal, platform,
       video_length_sec, video_length_note, variants_count,
       characters_mode, characters_desc, story_direction, tone, cta,
       color_preferences, music_mode, music_note, restrictions, additional_notes,
       industry, avatar_choice, avatar_backup_choice, mood_choice,
       music_choice, music_backup_choice, background_choice, background_backup_choice,
       script_style, cta_style,
       target_audience, aspect_ratio, language, voice_type, subtitles,
       brand_color_primary, brand_color_secondary, terms_confirmed_at,
       sla_hours
     ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN datetime('now') ELSE NULL END, ?)`
  ).bind(
    id, userId, body.designerId, body.subscriptionId,
    body.productName, body.productDescription, body.goal, body.platform,
    body.videoLengthSec, body.videoLengthNote ?? null, body.variantsCount ?? 1,
    body.charactersMode, body.charactersDesc ?? null, body.storyDirection, body.tone ?? null, body.cta,
    body.colorPreferences ?? null, body.musicMode ?? 'pick_for_me', body.musicNote ?? null,
    body.restrictions ?? null, body.additionalNotes ?? null,
    body.industry ?? null, body.avatarChoice ?? null, body.avatarBackupChoice ?? null, body.moodChoice ?? null,
    body.musicChoice ?? null, body.musicBackupChoice ?? null, body.backgroundChoice ?? null, body.backgroundBackupChoice ?? null,
    body.scriptStyle ?? null, body.ctaStyle ?? null,
    body.targetAudience ?? null, body.aspectRatio ?? null, body.language ?? null, body.voiceType ?? null, body.subtitles ?? null,
    body.brandColorPrimary ?? null, body.brandColorSecondary ?? null,
    body.termsConfirmed ? 1 : 0,
    body.slaHours
  ).run();

  return c.json({ id }, 201);
});

requests.patch('/:id', async (c) => {
  // Edits a draft in place — used by "continue editing" from the drafts list.
  // Only allowed while still a draft; once submitted the brief is locked.
  const id = c.req.param('id');
  const body = await c.req.json<RequestBody>();

  await c.env.DB.prepare(
    `UPDATE requests SET
       designer_id = ?, subscription_id = ?, sla_hours = ?,
       product_name = ?, product_description = ?, goal = ?, platform = ?,
       video_length_sec = ?, video_length_note = ?, variants_count = ?,
       characters_mode = ?, characters_desc = ?, story_direction = ?, tone = ?, cta = ?,
       color_preferences = ?, music_mode = ?, music_note = ?, restrictions = ?, additional_notes = ?,
       industry = ?, avatar_choice = ?, avatar_backup_choice = ?, mood_choice = ?,
       music_choice = ?, music_backup_choice = ?, background_choice = ?, background_backup_choice = ?,
       script_style = ?, cta_style = ?,
       target_audience = ?, aspect_ratio = ?, language = ?, voice_type = ?, subtitles = ?,
       brand_color_primary = ?, brand_color_secondary = ?,
       terms_confirmed_at = CASE WHEN ? THEN COALESCE(terms_confirmed_at, datetime('now')) ELSE terms_confirmed_at END,
       updated_at = datetime('now')
     WHERE id = ? AND status = 'draft'`
  ).bind(
    body.designerId, body.subscriptionId, body.slaHours,
    body.productName, body.productDescription, body.goal, body.platform,
    body.videoLengthSec, body.videoLengthNote ?? null, body.variantsCount ?? 1,
    body.charactersMode, body.charactersDesc ?? null, body.storyDirection, body.tone ?? null, body.cta,
    body.colorPreferences ?? null, body.musicMode ?? 'pick_for_me', body.musicNote ?? null,
    body.restrictions ?? null, body.additionalNotes ?? null,
    body.industry ?? null, body.avatarChoice ?? null, body.avatarBackupChoice ?? null, body.moodChoice ?? null,
    body.musicChoice ?? null, body.musicBackupChoice ?? null, body.backgroundChoice ?? null, body.backgroundBackupChoice ?? null,
    body.scriptStyle ?? null, body.ctaStyle ?? null,
    body.targetAudience ?? null, body.aspectRatio ?? null, body.language ?? null, body.voiceType ?? null, body.subtitles ?? null,
    body.brandColorPrimary ?? null, body.brandColorSecondary ?? null,
    body.termsConfirmed ? 1 : 0,
    id
  ).run();

  return c.json({ ok: true });
});

requests.delete('/:id', async (c) => {
  // Only ever allowed on drafts — anything queued or further along is real
  // work in flight and shouldn't be deletable from the client.
  const id = c.req.param('id');
  const request = await c.env.DB.prepare(`SELECT status FROM requests WHERE id = ?`).bind(id).first<{ status: string }>();
  if (!request || request.status !== 'draft') return c.json({ ok: true });

  // request_assets rows cascade-delete with the request (schema FK), but that
  // only cleans up D1 — the R2 objects themselves are a separate store and
  // would otherwise leak forever, since nothing else ever revisits this id.
  const { results: orphanedAssets } = await c.env.DB.prepare(
    'SELECT r2_key FROM request_assets WHERE request_id = ?'
  ).bind(id).all<{ r2_key: string }>();
  if (orphanedAssets.length) {
    await c.env.ASSETS.delete(orphanedAssets.map((a) => a.r2_key));
  }

  await c.env.DB.prepare(`DELETE FROM requests WHERE id = ? AND status = 'draft'`).bind(id).run();
  return c.json({ ok: true });
});

requests.post('/:id/links', async (c) => {
  const id = c.req.param('id');
  const { url } = await c.req.json<{ url: string }>();
  await c.env.DB.prepare('INSERT INTO request_links (id, request_id, url) VALUES (?, ?, ?)')
    .bind(crypto.randomUUID(), id, url)
    .run();
  return c.json({ ok: true });
});

requests.post('/:id/submit', async (c) => {
  const id = c.req.param('id');

  const request = await c.env.DB.prepare(
    `SELECT designer_id, product_name, product_description, target_audience,
            cta_style, story_direction, terms_confirmed_at, status
     FROM requests WHERE id = ?`
  ).bind(id).first<{
    designer_id: string | null;
    product_name: string;
    product_description: string;
    target_audience: string | null;
    cta_style: string | null;
    story_direction: string;
    terms_confirmed_at: string | null;
    status: string;
  }>();
  if (!request) return c.json({ error: 'not_found' }, 404);
  if (request.status !== 'draft') return c.json({ error: 'not_a_draft' }, 409);

  const { count: logoCount } = (await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM request_assets WHERE request_id = ? AND type = 'logo'"
  ).bind(id).first<{ count: number }>()) ?? { count: 0 };

  const missing: string[] = [];
  if (!request.designer_id) missing.push('designer');
  if (!request.product_name.trim()) missing.push('product name');
  if (!request.product_description.trim()) missing.push('product description');
  if (!logoCount) missing.push('logo');
  if (!request.target_audience) missing.push('target audience');
  if (!request.cta_style) missing.push('call-to-action style');
  if (!request.story_direction.trim()) missing.push('story direction / dialogue');
  if (!request.terms_confirmed_at) missing.push('approval & revision rules confirmation');

  if (missing.length) {
    return c.json({ error: 'incomplete_request', missing }, 400);
  }

  try {
    await c.env.DB.prepare(
      `UPDATE requests
       SET status = 'queued',
           submitted_at = datetime('now'),
           sla_deadline = datetime('now', '+' || sla_hours || ' hours')
       WHERE id = ? AND status = 'draft'`
    ).bind(id).run();
  } catch (err) {
    // idx_one_active_request_per_customer (schema.sql) rejects a 2nd active request.
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'active_request_exists' }, 409);
    }
    throw err;
  }
  return c.json({ ok: true });
});

requests.post('/:id/start', async (c) => {
  // Designer begins work — the only transition into 'in_progress' from a
  // fresh 'queued' state (as opposed to resuming after a clarification pause).
  const id = c.req.param('id');
  await c.env.DB.prepare(
    `UPDATE requests SET status = 'in_progress', started_at = datetime('now') WHERE id = ? AND status = 'queued'`
  ).bind(id).run();
  return c.json({ ok: true });
});

const MAX_COMMENT_ATTACHMENTS = 2;

// Links assets to a comment via the many-to-many join table — this is what
// lets a customer reference an already-uploaded file (e.g. the brief's logo)
// from a reply without duplicating it, alongside any newly-uploaded ones.
// The SELECT-based INSERT also silently drops any assetId that doesn't
// actually belong to this request, rather than trusting the client.
function linkAttachmentsStatement(db: D1Database, commentId: string, requestId: string, assetIds: string[]) {
  const placeholders = assetIds.map(() => '?').join(',');
  return db.prepare(
    `INSERT INTO request_comment_assets (comment_id, asset_id)
     SELECT ?, id FROM request_assets WHERE id IN (${placeholders}) AND request_id = ?`
  ).bind(commentId, ...assetIds, requestId);
}

requests.post('/:id/ask', async (c) => {
  // Designer asks a clarifying question — pauses the SLA timer.
  const id = c.req.param('id');
  const { message, assetIds = [] } = await c.req.json<{ message: string; assetIds?: string[] }>();
  const authorId = currentUserId(c);
  if (!authorId) return c.json({ error: 'unauthenticated' }, 401);
  if (assetIds.length > MAX_COMMENT_ATTACHMENTS) {
    return c.json({ error: 'too_many_attachments', max: MAX_COMMENT_ATTACHMENTS }, 400);
  }

  const commentId = crypto.randomUUID();
  const statements = [
    c.env.DB.prepare('INSERT INTO request_comments (id, request_id, author_id, message) VALUES (?, ?, ?, ?)')
      .bind(commentId, id, authorId, message),
    c.env.DB.prepare(`UPDATE requests SET status = 'needs_info', paused_at = datetime('now') WHERE id = ?`).bind(id),
  ];
  if (assetIds.length) statements.push(linkAttachmentsStatement(c.env.DB, commentId, id, assetIds));
  await c.env.DB.batch(statements);
  return c.json({ ok: true, commentId });
});

requests.post('/:id/reply', async (c) => {
  // Customer replies — resumes the timer, folding the elapsed pause into total_paused_seconds.
  const id = c.req.param('id');
  const { message, assetIds = [] } = await c.req.json<{ message: string; assetIds?: string[] }>();
  const authorId = currentUserId(c);
  if (!authorId) return c.json({ error: 'unauthenticated' }, 401);
  if (assetIds.length > MAX_COMMENT_ATTACHMENTS) {
    return c.json({ error: 'too_many_attachments', max: MAX_COMMENT_ATTACHMENTS }, 400);
  }

  const commentId = crypto.randomUUID();
  const statements = [
    c.env.DB.prepare('INSERT INTO request_comments (id, request_id, author_id, message) VALUES (?, ?, ?, ?)')
      .bind(commentId, id, authorId, message),
    c.env.DB.prepare(
      `UPDATE requests SET
         status = 'in_progress',
         total_paused_seconds = total_paused_seconds + CAST((julianday('now') - julianday(paused_at)) * 86400 AS INTEGER),
         paused_at = NULL
       WHERE id = ?`
    ).bind(id),
  ];
  if (assetIds.length) statements.push(linkAttachmentsStatement(c.env.DB, commentId, id, assetIds));
  await c.env.DB.batch(statements);
  return c.json({ ok: true, commentId });
});

requests.post('/:id/comments', async (c) => {
  // Plain comment — unlike /ask, doesn't touch status or the timer. Used for
  // things like a designer's note attached to a delivery.
  const id = c.req.param('id');
  const { message, assetIds = [] } = await c.req.json<{ message: string; assetIds?: string[] }>();
  const authorId = currentUserId(c);
  if (!authorId) return c.json({ error: 'unauthenticated' }, 401);
  if (assetIds.length > MAX_COMMENT_ATTACHMENTS) {
    return c.json({ error: 'too_many_attachments', max: MAX_COMMENT_ATTACHMENTS }, 400);
  }

  const commentId = crypto.randomUUID();
  const statements = [
    c.env.DB.prepare('INSERT INTO request_comments (id, request_id, author_id, message) VALUES (?, ?, ?, ?)')
      .bind(commentId, id, authorId, message),
  ];
  if (assetIds.length) statements.push(linkAttachmentsStatement(c.env.DB, commentId, id, assetIds));
  await c.env.DB.batch(statements);
  return c.json({ ok: true, commentId });
});

requests.post('/:id/request-payment', async (c) => {
  // Posts a payment-request comment. We never touch the money — this just
  // records which of the designer's own saved UPI accounts to point the
  // auto-generated QR/link at (looked up server-side, never trusting a raw
  // upiId from the client, so a request can't be spoofed to someone else's account).
  const id = c.req.param('id');
  const { accountId, amountPaise, assetIds = [] } = await c.req.json<{
    accountId: string;
    amountPaise: number;
    assetIds?: string[];
  }>();
  const authorId = currentUserId(c);
  if (!authorId) return c.json({ error: 'unauthenticated' }, 401);
  if (!amountPaise || amountPaise <= 0) return c.json({ error: 'invalid_amount' }, 400);
  if (assetIds.length > MAX_COMMENT_ATTACHMENTS) {
    return c.json({ error: 'too_many_attachments', max: MAX_COMMENT_ATTACHMENTS }, 400);
  }

  const account = await c.env.DB.prepare(
    'SELECT upi_id, label FROM designer_payment_accounts WHERE id = ? AND designer_id = ?'
  ).bind(accountId, authorId).first<{ upi_id: string; label: string }>();
  if (!account) return c.json({ error: 'invalid_account' }, 400);

  const commentId = crypto.randomUUID();
  const message = `Requested ₹${(amountPaise / 100).toFixed(0)} for this delivery.`;
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO request_comments (id, request_id, author_id, message, payment_amount_paise, payment_upi_id, payment_upi_label)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(commentId, id, authorId, message, amountPaise, account.upi_id, account.label),
  ];
  if (assetIds.length) statements.push(linkAttachmentsStatement(c.env.DB, commentId, id, assetIds));
  await c.env.DB.batch(statements);

  return c.json({ ok: true, commentId });
});

requests.post('/:id/deliver', async (c) => {
  // Only a real transition from 'in_progress' — otherwise a stale tab or a
  // direct URL visit to the deliver page could regress an already-approved
  // request back to 'delivered'.
  const id = c.req.param('id');
  await c.env.DB.prepare(
    `UPDATE requests SET status = 'delivered', delivered_at = datetime('now') WHERE id = ? AND status = 'in_progress'`
  ).bind(id).run();
  return c.json({ ok: true });
});

const FEEDBACK_RATINGS = new Set(['good', 'needs_improvement', 'bad']);

requests.post('/:id/approve', async (c) => {
  const id = c.req.param('id');
  const { rating, note } = await c.req.json<{ rating?: string; note?: string }>().catch(() => ({}) as { rating?: string; note?: string });

  if (rating !== undefined && !FEEDBACK_RATINGS.has(rating)) {
    return c.json({ error: 'invalid_rating' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE requests SET status = 'approved', approved_at = datetime('now'), feedback_rating = ?, feedback_note = ? WHERE id = ?`
  ).bind(rating ?? null, note?.trim() || null, id).run();
  return c.json({ ok: true });
});

requests.post('/:id/revise', async (c) => {
  // Customer requests a revision — spawns a new linked request with a fresh SLA window
  // of the same length as the original (per the locked "revision gets another full window" rule).
  const id = c.req.param('id');
  const original = await c.env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!original) return c.json({ error: 'not_found' }, 404);

  const newId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO requests (
       id, customer_id, designer_id, subscription_id, parent_request_id, is_revision, status,
       product_name, product_description, goal, platform, video_length_sec, variants_count,
       characters_mode, story_direction, cta, sla_hours, submitted_at, sla_deadline
     ) VALUES (?, ?, ?, ?, ?, 1, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+' || ? || ' hours'))`
  ).bind(
    newId, original.customer_id, original.designer_id, original.subscription_id, id,
    original.product_name, original.product_description, original.goal, original.platform,
    original.video_length_sec, original.variants_count, original.characters_mode,
    original.story_direction, original.cta, original.sla_hours, original.sla_hours
  ).run();

  await c.env.DB.prepare(`UPDATE requests SET status = 'revision_requested' WHERE id = ?`).bind(id).run();
  return c.json({ id: newId }, 201);
});

export default requests;
