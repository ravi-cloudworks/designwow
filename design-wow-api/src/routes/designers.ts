import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/auth';

const designers = new Hono<{ Bindings: Bindings }>();

designers.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.avatar_url, d.bio, d.specialty_tags,
            SUM(CASE WHEN r.feedback_rating = 'good' THEN 1 ELSE 0 END) AS feedback_good_count,
            SUM(CASE WHEN r.feedback_rating = 'needs_improvement' THEN 1 ELSE 0 END) AS feedback_needs_improvement_count,
            SUM(CASE WHEN r.feedback_rating = 'bad' THEN 1 ELSE 0 END) AS feedback_bad_count
     FROM designer_profiles d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN requests r ON r.designer_id = u.id AND r.feedback_rating IS NOT NULL
     WHERE d.active = 1
     GROUP BY u.id`
  ).all();
  return c.json({ designers: results });
});

designers.get('/me', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const profile = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.avatar_url, d.bio, d.specialty_tags, d.active, d.phone
     FROM users u JOIN designer_profiles d ON d.user_id = u.id
     WHERE u.id = ?`
  ).bind(userId).first();
  if (!profile) return c.json({ error: 'not_found' }, 404);

  const stats = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS delivered_count,
       AVG((julianday(delivered_at) - julianday(submitted_at)) * 86400 - total_paused_seconds) AS avg_turnaround_seconds,
       SUM(CASE WHEN delivered_at <= datetime(sla_deadline, '+' || total_paused_seconds || ' seconds') THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS on_time_rate
     FROM requests
     WHERE designer_id = ? AND delivered_at IS NOT NULL`
  ).bind(userId).first();

  const feedback = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN feedback_rating = 'good' THEN 1 ELSE 0 END) AS good_count,
       SUM(CASE WHEN feedback_rating = 'needs_improvement' THEN 1 ELSE 0 END) AS needs_improvement_count,
       SUM(CASE WHEN feedback_rating = 'bad' THEN 1 ELSE 0 END) AS bad_count
     FROM requests
     WHERE designer_id = ? AND feedback_rating IS NOT NULL`
  ).bind(userId).first();

  return c.json({ profile, stats, feedback });
});

designers.patch('/me', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const { bio, specialtyTags, active, phone } = await c.req.json<{
    bio?: string;
    specialtyTags?: string[];
    active?: boolean;
    phone?: string;
  }>();

  await c.env.DB.prepare(
    `UPDATE designer_profiles SET
       bio = COALESCE(?, bio),
       specialty_tags = COALESCE(?, specialty_tags),
       active = COALESCE(?, active),
       phone = COALESCE(?, phone)
     WHERE user_id = ?`
  ).bind(
    bio ?? null,
    specialtyTags ? JSON.stringify(specialtyTags) : null,
    active === undefined ? null : active ? 1 : 0,
    phone === undefined ? null : phone.trim(),
    userId
  ).run();

  return c.json({ ok: true });
});

designers.get('/customers', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const { results } = await c.env.DB.prepare(
    `SELECT cu.id, cu.name, cu.email,
            s.plan_tier, s.status AS subscription_status, s.amount_paise, s.started_at,
            COUNT(r.id) AS request_count,
            MAX(CASE WHEN r.status IN ('queued', 'in_progress', 'needs_info') THEN 1 ELSE 0 END) AS has_active_request
     FROM requests r
     JOIN users cu ON cu.id = r.customer_id
     JOIN subscriptions s ON s.id = r.subscription_id
     WHERE r.designer_id = ?
     GROUP BY cu.id
     ORDER BY s.started_at ASC`
  ).bind(userId).all<{
    id: string;
    name: string;
    email: string;
    plan_tier: string;
    subscription_status: string;
    amount_paise: number;
    started_at: string;
    request_count: number;
    has_active_request: number;
  }>();

  // No payments ledger yet (Dodo Payments integration is a later phase), so
  // "amount paid" is an approximation: months active × the plan's monthly price.
  const customers = results.map((row) => {
    const monthsActive = Math.max(1, Math.round((Date.now() - Date.parse(`${row.started_at.replace(' ', 'T')}Z`)) / (1000 * 60 * 60 * 24 * 30)));
    return { ...row, approx_amount_paid_paise: monthsActive * row.amount_paise };
  });

  return c.json({ customers });
});

designers.get('/me/payment-accounts', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM designer_payment_accounts WHERE designer_id = ? ORDER BY is_default DESC, created_at ASC`
  ).bind(userId).all();

  return c.json({ accounts: results });
});

designers.post('/me/payment-accounts', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const { label, upiId } = await c.req.json<{ label: string; upiId: string }>();

  const { count } = (await c.env.DB.prepare('SELECT COUNT(*) AS count FROM designer_payment_accounts WHERE designer_id = ?')
    .bind(userId)
    .first<{ count: number }>())!;

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO designer_payment_accounts (id, designer_id, label, upi_id, is_default) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, userId, label, upiId, count === 0 ? 1 : 0).run(); // first account added is automatically the default

  return c.json({ id }, 201);
});

designers.patch('/me/payment-accounts/:accountId', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const accountId = c.req.param('accountId');
  const { setDefault } = await c.req.json<{ setDefault?: boolean }>();

  if (setDefault) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE designer_payment_accounts SET is_default = 0 WHERE designer_id = ?').bind(userId),
      c.env.DB.prepare('UPDATE designer_payment_accounts SET is_default = 1 WHERE id = ? AND designer_id = ?').bind(accountId, userId),
    ]);
  }

  return c.json({ ok: true });
});

designers.delete('/me/payment-accounts/:accountId', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const accountId = c.req.param('accountId');

  await c.env.DB.prepare('DELETE FROM designer_payment_accounts WHERE id = ? AND designer_id = ?').bind(accountId, userId).run();

  // If that happened to be the default, promote the oldest remaining one so
  // there's always a sane default rather than none at all.
  const remaining = await c.env.DB.prepare(
    `SELECT id FROM designer_payment_accounts WHERE designer_id = ? AND is_default = 1`
  ).bind(userId).first();
  if (!remaining) {
    await c.env.DB.prepare(
      `UPDATE designer_payment_accounts SET is_default = 1
       WHERE designer_id = ? AND id = (SELECT id FROM designer_payment_accounts WHERE designer_id = ? ORDER BY created_at ASC LIMIT 1)`
    ).bind(userId, userId).run();
  }

  return c.json({ ok: true });
});

// Eligible-to-showcase assets: this designer's own delivered work only —
// mirrors the History page's "delivered_at IS NOT NULL" definition of a
// completed delivery, regardless of whether it went on to be approved,
// revised, etc.
designers.get('/me/showcase/candidates', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.file_name, a.mime_type, r.product_name,
            EXISTS(SELECT 1 FROM designer_showcase_items si WHERE si.asset_id = a.id) AS is_showcased
     FROM request_assets a
     JOIN requests r ON r.id = a.request_id
     WHERE r.designer_id = ? AND a.type = 'output' AND r.delivered_at IS NOT NULL
     ORDER BY a.created_at DESC`
  ).bind(userId).all();

  return c.json({ candidates: results });
});

designers.get('/me/showcase', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const { results } = await c.env.DB.prepare(
    `SELECT id, file_name, mime_type, size_bytes, asset_id, caption, created_at
     FROM designer_showcase_items WHERE designer_id = ? ORDER BY created_at ASC`
  ).bind(userId).all();

  return c.json({ items: results });
});

designers.post('/me/showcase', async (c) => {
  // Add from an existing delivered request.
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const { assetId, caption } = await c.req.json<{ assetId: string; caption?: string }>();

  // Only ever an asset that's genuinely this designer's own delivered output
  // — never trust the client on ownership. File info is copied in (not just
  // referenced) so the showcase table is self-sufficient to serve from.
  const asset = await c.env.DB.prepare(
    `SELECT a.r2_key, a.file_name, a.mime_type, a.size_bytes
     FROM request_assets a JOIN requests r ON r.id = a.request_id
     WHERE a.id = ? AND r.designer_id = ? AND a.type = 'output' AND r.delivered_at IS NOT NULL`
  ).bind(assetId, userId).first<{ r2_key: string; file_name: string; mime_type: string; size_bytes: number }>();
  if (!asset) return c.json({ error: 'not_eligible' }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO designer_showcase_items (id, designer_id, r2_key, file_name, mime_type, size_bytes, asset_id, caption)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, asset.r2_key, asset.file_name, asset.mime_type, asset.size_bytes, assetId, caption?.trim() || null).run();

  return c.json({ id }, 201);
});

const SHOWCASE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const SHOWCASE_UPLOAD_ACCEPT = ['image/png', 'image/jpeg', 'video/mp4', 'video/quicktime', 'application/pdf'];

designers.put('/me/showcase/upload/:filename', async (c) => {
  // Add a standalone promo file — a demo reel, a personal intro, anything
  // that was never part of an actual client delivery, so there's no
  // request_assets row to source from.
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const contentType = c.req.header('Content-Type') ?? '';
  if (!SHOWCASE_UPLOAD_ACCEPT.includes(contentType)) {
    return c.json({ error: 'unsupported_type', allowed: SHOWCASE_UPLOAD_ACCEPT }, 415);
  }
  const contentLength = Number(c.req.header('Content-Length') ?? 0);
  if (!contentLength || contentLength > SHOWCASE_UPLOAD_MAX_BYTES) {
    return c.json({ error: 'file_too_large', maxBytes: SHOWCASE_UPLOAD_MAX_BYTES }, 413);
  }

  const filename = c.req.param('filename');
  const id = crypto.randomUUID();
  const key = `showcase/${userId}/${id}-${filename}`;
  await c.env.ASSETS.put(key, c.req.raw.body, { httpMetadata: { contentType } });

  await c.env.DB.prepare(
    `INSERT INTO designer_showcase_items (id, designer_id, r2_key, file_name, mime_type, size_bytes, asset_id, caption)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
  ).bind(id, userId, key, filename, contentType, contentLength).run();

  return c.json({ id }, 201);
});

designers.put('/me/showcase/:itemId/thumbnail', async (c) => {
  // A JPEG frame captured client-side (mobile browsers often won't render a
  // <video preload="metadata"> frame at all, so a stored image is the only
  // reliable preview). Always exclusively owned by the showcase item — never
  // shared, unlike the main r2_key for a deliverable-sourced item.
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const itemId = c.req.param('itemId');

  const owns = await c.env.DB.prepare(
    'SELECT id FROM designer_showcase_items WHERE id = ? AND designer_id = ?'
  ).bind(itemId, userId).first();
  if (!owns) return c.json({ error: 'not_found' }, 404);

  const contentType = c.req.header('Content-Type') ?? '';
  if (contentType !== 'image/jpeg') return c.json({ error: 'unsupported_type' }, 415);
  const contentLength = Number(c.req.header('Content-Length') ?? 0);
  if (!contentLength || contentLength > 2 * 1024 * 1024) return c.json({ error: 'file_too_large' }, 413);

  const key = `showcase/${userId}/${itemId}-thumb.jpg`;
  await c.env.ASSETS.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  await c.env.DB.prepare('UPDATE designer_showcase_items SET thumbnail_r2_key = ? WHERE id = ?').bind(key, itemId).run();

  return c.json({ ok: true });
});

designers.delete('/me/showcase/:itemId', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const itemId = c.req.param('itemId');

  const item = await c.env.DB.prepare(
    'SELECT r2_key, asset_id, thumbnail_r2_key FROM designer_showcase_items WHERE id = ? AND designer_id = ?'
  ).bind(itemId, userId).first<{ r2_key: string; asset_id: string | null; thumbnail_r2_key: string | null }>();
  if (!item) return c.json({ ok: true });

  // Only delete the main R2 object for a standalone promo upload (asset_id
  // null) — a deliverable-sourced item shares its r2_key with the original
  // delivery, which the request itself still owns. The thumbnail, though,
  // is always exclusively this item's own — delete it either way.
  if (!item.asset_id) {
    await c.env.ASSETS.delete(item.r2_key);
  }
  if (item.thumbnail_r2_key) {
    await c.env.ASSETS.delete(item.thumbnail_r2_key);
  }
  await c.env.DB.prepare('DELETE FROM designer_showcase_items WHERE id = ?').bind(itemId).run();
  return c.json({ ok: true });
});

// Public showcase page — no auth. Only ever exposes what the designer
// explicitly curated (designer_showcase_items), never their raw delivery
// history or contact details.
designers.get('/:id/public', async (c) => {
  const id = c.req.param('id');

  const profile = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.avatar_url, d.bio, d.specialty_tags, d.active, d.phone
     FROM users u JOIN designer_profiles d ON d.user_id = u.id
     WHERE u.id = ?`
  ).bind(id).first();
  if (!profile) return c.json({ error: 'not_found' }, 404);

  const { results: items } = await c.env.DB.prepare(
    `SELECT id, file_name, mime_type, caption FROM designer_showcase_items WHERE designer_id = ? ORDER BY created_at ASC`
  ).bind(id).all();

  return c.json({ profile, items });
});

// No auth — serves any showcase item's file directly. Safe to be this open
// since only what the designer explicitly added ever has a row here at all.
designers.get('/showcase-items/:itemId/file', async (c) => {
  const item = await c.env.DB.prepare(
    'SELECT r2_key, mime_type FROM designer_showcase_items WHERE id = ?'
  ).bind(c.req.param('itemId')).first<{ r2_key: string; mime_type: string }>();
  if (!item) return c.json({ error: 'not_found' }, 404);

  const object = await c.env.ASSETS.get(item.r2_key);
  if (!object) return c.json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': item.mime_type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

designers.get('/showcase-items/:itemId/thumbnail', async (c) => {
  const item = await c.env.DB.prepare(
    'SELECT thumbnail_r2_key FROM designer_showcase_items WHERE id = ?'
  ).bind(c.req.param('itemId')).first<{ thumbnail_r2_key: string | null }>();
  if (!item?.thumbnail_r2_key) return c.json({ error: 'not_found' }, 404);

  const object = await c.env.ASSETS.get(item.thumbnail_r2_key);
  if (!object) return c.json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
  });
});

// ---------------------------------------------------------------
// Designer asset library — reusable presets (avatar/mood/music) for the
// structured brief picker. Distinct from the public showcase: this is
// private working material used to populate a customer's picker options,
// never shown on the public /d/:id page.
// ---------------------------------------------------------------

const LIBRARY_ACCEPT: Record<string, string[]> = {
  avatar: ['image/png', 'image/jpeg'],
  mood: ['image/png', 'image/jpeg'],
  music: ['audio/mpeg', 'audio/mp3', 'audio/wav'],
};
const LIBRARY_MAX_BYTES = 20 * 1024 * 1024;

designers.get('/me/asset-library', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const { results } = await c.env.DB.prepare(
    `SELECT id, category, label, file_name, mime_type, size_bytes, industry_tags, created_at
     FROM designer_asset_library WHERE designer_id = ? ORDER BY category, created_at DESC`
  ).bind(userId).all();

  return c.json({ items: results });
});

designers.put('/me/asset-library/:category/:filename', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const category = c.req.param('category');
  if (!LIBRARY_ACCEPT[category]) return c.json({ error: 'invalid_category' }, 400);

  const contentType = c.req.header('Content-Type') ?? '';
  if (!LIBRARY_ACCEPT[category].includes(contentType)) {
    return c.json({ error: 'unsupported_type', allowed: LIBRARY_ACCEPT[category] }, 415);
  }
  const contentLength = Number(c.req.header('Content-Length') ?? 0);
  if (!contentLength || contentLength > LIBRARY_MAX_BYTES) {
    return c.json({ error: 'file_too_large', maxBytes: LIBRARY_MAX_BYTES }, 413);
  }

  // Label + industry tags travel as query params since this is a raw file
  // PUT, same pattern as filename-in-path elsewhere in this app.
  const label = (c.req.query('label') ?? '').trim().slice(0, 100);
  if (!label) return c.json({ error: 'missing_label' }, 400);
  const industries = (c.req.query('industries') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const filename = c.req.param('filename');
  const id = crypto.randomUUID();
  const key = `asset-library/${userId}/${id}-${filename}`;
  await c.env.ASSETS.put(key, c.req.raw.body, { httpMetadata: { contentType } });

  await c.env.DB.prepare(
    `INSERT INTO designer_asset_library (id, designer_id, category, label, r2_key, file_name, mime_type, size_bytes, industry_tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, category, label, key, filename, contentType, contentLength, industries.length ? JSON.stringify(industries) : null).run();

  return c.json({ id }, 201);
});

designers.delete('/me/asset-library/:itemId', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const itemId = c.req.param('itemId');

  const item = await c.env.DB.prepare(
    'SELECT r2_key FROM designer_asset_library WHERE id = ? AND designer_id = ?'
  ).bind(itemId, userId).first<{ r2_key: string }>();
  if (!item) return c.json({ ok: true });

  await c.env.ASSETS.delete(item.r2_key);
  await c.env.DB.prepare('DELETE FROM designer_asset_library WHERE id = ?').bind(itemId).run();
  return c.json({ ok: true });
});

// Used while a customer is building a brief — needs auth (any logged-in
// user), but not the designer's own session specifically, since it's the
// customer fetching someone else's library.
designers.get('/:id/library', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const designerId = c.req.param('id');
  const category = c.req.query('category');
  const industry = c.req.query('industry');
  if (!category || !LIBRARY_ACCEPT[category]) return c.json({ error: 'invalid_category' }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT id, label, file_name, mime_type, industry_tags FROM designer_asset_library
     WHERE designer_id = ? AND category = ?
     AND (industry_tags IS NULL OR industry_tags = '[]' OR ? IS NULL OR EXISTS (
       SELECT 1 FROM json_each(industry_tags) WHERE json_each.value = ?
     ))
     ORDER BY created_at DESC`
  ).bind(designerId, category, industry ?? null, industry ?? '').all();

  return c.json({ items: results });
});

designers.get('/library-items/:itemId/file', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const item = await c.env.DB.prepare(
    'SELECT r2_key, mime_type FROM designer_asset_library WHERE id = ?'
  ).bind(c.req.param('itemId')).first<{ r2_key: string; mime_type: string }>();
  if (!item) return c.json({ error: 'not_found' }, 404);

  const object = await c.env.ASSETS.get(item.r2_key);
  if (!object) return c.json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    headers: { 'Content-Type': item.mime_type || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' },
  });
});

export default designers;
