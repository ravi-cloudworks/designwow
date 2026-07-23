import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

// Public portfolio page for a designer — ported from design-wow-api's
// designer_showcase_items pattern (design-wow itself is untouched; this is
// StagePay's own copy, adapted to its own schema/media bucket). "Eligible"
// candidate = an item belonging to a stage that's actually been locked (paid
// + approved by the customer) with real uploaded output — the equivalent of
// design-wow's "delivered_at IS NOT NULL", expressed via stage_locks instead.
const showcase = new Hono<{ Bindings: Bindings }>();

type MediaFileEntry = { key: string; fileName: string; kind: string };

// No plan/subscription tiers exist in the DB yet to gate this by — a single
// fixed cap for now, easy to make plan-dependent later once that exists.
// One shared count across every add path (candidate-add and promo/portfolio
// upload both check the same showcase_items row count), so this cap already
// covers the Creative Portfolio items too, not just project deliverables.
const SHOWCASE_MAX_ITEMS = 25;

showcase.get('/showcase/candidates', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const { results: rows } = await c.env.DB.prepare(
    `SELECT i.id as item_id, i.name as item_name, i.stage, i.item_key, iv.media_files, p.name as project_name
     FROM items i
     JOIN item_versions iv ON iv.item_id = i.id AND iv.version_number = 1
     JOIN projects p ON p.id = i.project_id
     JOIN stage_locks sl ON sl.project_id = i.project_id AND sl.stage = i.stage
     WHERE p.user_id = ? AND sl.locked = 1 AND iv.media_files != '[]'`
  )
    .bind(userId)
    .all<{ item_id: string; item_name: string; stage: number; item_key: string; media_files: string; project_name: string }>();

  const { results: showcased } = await c.env.DB.prepare('SELECT r2_key FROM showcase_items WHERE user_id = ?')
    .bind(userId)
    .all<{ r2_key: string }>();
  const showcasedKeys = new Set(showcased.map((s) => s.r2_key));

  const candidates: {
    itemId: string; itemName: string; stage: number; itemKey: string; projectName: string;
    key: string; fileName: string; kind: string; isShowcased: boolean;
  }[] = [];
  for (const row of rows) {
    const files = JSON.parse(row.media_files || '[]') as MediaFileEntry[];
    for (const f of files) {
      candidates.push({
        itemId: row.item_id, itemName: row.item_name, stage: row.stage, itemKey: row.item_key, projectName: row.project_name,
        key: f.key, fileName: f.fileName, kind: f.kind, isShowcased: showcasedKeys.has(f.key),
      });
    }
  }
  return c.json({ candidates });
});

showcase.get('/showcase', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const { results } = await c.env.DB.prepare(
    `SELECT id, file_name, mime_type, size_bytes, source_item_id, caption, thumbnail_r2_key, created_at
     FROM showcase_items WHERE user_id = ? ORDER BY created_at ASC`
  )
    .bind(userId)
    .all();
  const user = await c.env.DB.prepare('SELECT showcase_cover_r2_key FROM users WHERE id = ?').bind(userId).first<{ showcase_cover_r2_key: string | null }>();
  return c.json({ items: results, max: SHOWCASE_MAX_ITEMS, hasCover: !!user?.showcase_cover_r2_key });
});

showcase.post('/showcase', async (c) => {
  // Add from an existing eligible item (see the module comment above).
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const { sourceItemId, key, fileName, caption } = await c.req
    .json<{ sourceItemId?: string; key?: string; fileName?: string; caption?: string }>()
    .catch(() => ({}) as { sourceItemId?: string; key?: string; fileName?: string; caption?: string });
  if (!sourceItemId || !key || !fileName) return c.json({ error: 'source_item_and_key_required' }, 400);

  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM showcase_items WHERE user_id = ?').bind(userId).first<{ count: number }>();
  if ((countRow?.count ?? 0) >= SHOWCASE_MAX_ITEMS) return c.json({ error: 'showcase_limit_reached', max: SHOWCASE_MAX_ITEMS }, 400);

  // Only ever an item that's genuinely this designer's own, from a stage
  // that's actually locked — never trust the client on ownership/eligibility.
  const eligible = await c.env.DB.prepare(
    `SELECT iv.media_files FROM items i
     JOIN item_versions iv ON iv.item_id = i.id AND iv.version_number = 1
     JOIN projects p ON p.id = i.project_id
     JOIN stage_locks sl ON sl.project_id = i.project_id AND sl.stage = i.stage
     WHERE i.id = ? AND p.user_id = ? AND sl.locked = 1`
  )
    .bind(sourceItemId, userId)
    .first<{ media_files: string }>();
  if (!eligible) return c.json({ error: 'not_eligible' }, 400);
  const files = JSON.parse(eligible.media_files || '[]') as MediaFileEntry[];
  if (!files.some((f) => f.key === key)) return c.json({ error: 'not_eligible' }, 400);

  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  const mimeType = obj.httpMetadata?.contentType || 'application/octet-stream';

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO showcase_items (id, user_id, r2_key, file_name, mime_type, size_bytes, source_item_id, caption)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, key, fileName, mimeType, obj.size ?? 0, sourceItemId, caption?.trim() || null)
    .run();

  return c.json({ id }, 201);
});

const SHOWCASE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const SHOWCASE_UPLOAD_ACCEPT = ['image/png', 'image/jpeg', 'video/mp4', 'video/quicktime'];

showcase.put('/showcase/upload/:filename', async (c) => {
  // Standalone promo upload — a demo reel, a personal intro — never tied to
  // an actual StagePay item, so there's no source item to verify against.
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM showcase_items WHERE user_id = ?').bind(userId).first<{ count: number }>();
  if ((countRow?.count ?? 0) >= SHOWCASE_MAX_ITEMS) return c.json({ error: 'showcase_limit_reached', max: SHOWCASE_MAX_ITEMS }, 400);

  const contentType = c.req.header('Content-Type') ?? '';
  if (!SHOWCASE_UPLOAD_ACCEPT.includes(contentType)) return c.json({ error: 'unsupported_type', allowed: SHOWCASE_UPLOAD_ACCEPT }, 415);
  const contentLength = Number(c.req.header('Content-Length') ?? 0);
  if (!contentLength || contentLength > SHOWCASE_UPLOAD_MAX_BYTES) return c.json({ error: 'file_too_large', maxBytes: SHOWCASE_UPLOAD_MAX_BYTES }, 413);

  const filename = c.req.param('filename');
  const id = crypto.randomUUID();
  const key = `showcase/${userId}/${id}-${filename}`;
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });

  await c.env.DB.prepare(
    `INSERT INTO showcase_items (id, user_id, r2_key, file_name, mime_type, size_bytes, source_item_id, caption)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
  )
    .bind(id, userId, key, filename, contentType, contentLength)
    .run();

  return c.json({ id }, 201);
});

const COVER_MAX_BYTES = 5 * 1024 * 1024;
const COVER_ACCEPT = ['image/png', 'image/jpeg'];

// A single account-level banner, not a showcase_items row — one per
// designer, replacing whichever one existed before (not appended like the
// item gallery). Recommended 16:9 so it reads as roughly a quarter of a
// phone screen on load and a normal hero-banner height on desktop.
showcase.put('/showcase/cover', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const contentType = c.req.header('Content-Type') ?? '';
  if (!COVER_ACCEPT.includes(contentType)) return c.json({ error: 'unsupported_type', allowed: COVER_ACCEPT }, 415);
  const contentLength = Number(c.req.header('Content-Length') ?? 0);
  if (!contentLength || contentLength > COVER_MAX_BYTES) return c.json({ error: 'file_too_large', maxBytes: COVER_MAX_BYTES }, 413);

  const existing = await c.env.DB.prepare('SELECT showcase_cover_r2_key FROM users WHERE id = ?').bind(userId).first<{ showcase_cover_r2_key: string | null }>();
  const key = `showcase/${userId}/cover-${crypto.randomUUID()}`;
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  await c.env.DB.prepare('UPDATE users SET showcase_cover_r2_key = ? WHERE id = ?').bind(key, userId).run();
  if (existing?.showcase_cover_r2_key) await c.env.MEDIA.delete(existing.showcase_cover_r2_key);

  return c.json({ ok: true });
});

showcase.delete('/showcase/cover', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const existing = await c.env.DB.prepare('SELECT showcase_cover_r2_key FROM users WHERE id = ?').bind(userId).first<{ showcase_cover_r2_key: string | null }>();
  if (existing?.showcase_cover_r2_key) await c.env.MEDIA.delete(existing.showcase_cover_r2_key);
  await c.env.DB.prepare('UPDATE users SET showcase_cover_r2_key = NULL WHERE id = ?').bind(userId).run();

  return c.json({ ok: true });
});

showcase.put('/showcase/:itemId/thumbnail', async (c) => {
  // A client-captured JPEG frame — mobile browsers often won't render a
  // <video preload="metadata"> frame reliably, so a stored image is the only
  // dependable preview. Always exclusively owned by this showcase item.
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const itemId = c.req.param('itemId');

  const owns = await c.env.DB.prepare('SELECT id FROM showcase_items WHERE id = ? AND user_id = ?').bind(itemId, userId).first();
  if (!owns) return c.json({ error: 'not_found' }, 404);

  const contentType = c.req.header('Content-Type') ?? '';
  if (contentType !== 'image/jpeg') return c.json({ error: 'unsupported_type' }, 415);
  const contentLength = Number(c.req.header('Content-Length') ?? 0);
  if (!contentLength || contentLength > 2 * 1024 * 1024) return c.json({ error: 'file_too_large' }, 413);

  const key = `showcase/${userId}/${itemId}-thumb.jpg`;
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  await c.env.DB.prepare('UPDATE showcase_items SET thumbnail_r2_key = ? WHERE id = ?').bind(key, itemId).run();

  return c.json({ ok: true });
});

showcase.delete('/showcase/:itemId', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const itemId = c.req.param('itemId');

  const item = await c.env.DB.prepare('SELECT r2_key, source_item_id, thumbnail_r2_key FROM showcase_items WHERE id = ? AND user_id = ?')
    .bind(itemId, userId)
    .first<{ r2_key: string; source_item_id: string | null; thumbnail_r2_key: string | null }>();
  if (!item) return c.json({ ok: true });

  // Only delete the main R2 object for a standalone promo upload — an item
  // sourced from a real StagePay deliverable shares its r2_key with that
  // item's own media_files, which the item itself still owns.
  if (!item.source_item_id) {
    await c.env.MEDIA.delete(item.r2_key);
  }
  if (item.thumbnail_r2_key) {
    await c.env.MEDIA.delete(item.thumbnail_r2_key);
  }
  await c.env.DB.prepare('DELETE FROM showcase_items WHERE id = ?').bind(itemId).run();
  return c.json({ ok: true });
});

// ---------- Public, no-login ----------
// Only ever exposes what the designer explicitly curated here — never their
// raw project/payment history or contact details.
// The path param can be either the raw user id (always works, forever —
// the stable fallback) or a designer's custom showcase_slug, if they've set
// one — resolved once here, then every subsequent query uses the real
// profile.id, never the raw param, since showcase_items is keyed by the
// real id regardless of which URL form a visitor used.
showcase.get('/showcase/:userId/public', async (c) => {
  const param = c.req.param('userId');
  const profile = await c.env.DB.prepare('SELECT id, name, avatar_url, contact_link, free_credits_remaining, showcase_cover_r2_key FROM users WHERE id = ? OR showcase_slug = ?')
    .bind(param, param)
    .first<{ id: string; name: string; avatar_url: string | null; contact_link: string | null; free_credits_remaining: number; showcase_cover_r2_key: string | null }>();
  if (!profile) return c.json({ error: 'not_found' }, 404);

  // Paused rather than 404'd deliberately — this is the designer's own
  // sales page, often visited by their own prospective client, so it reads
  // as routine unavailability rather than exposing a billing lapse.
  if (profile.free_credits_remaining <= 0) return c.json({ unavailable: true });

  // item_key (via the showcase item's source project item, if it has one)
  // lets the public page group by category (Storyboard/Characters/Scenes/
  // etc.) — standalone promo uploads have no source item, so item_key is
  // null for those and the frontend buckets them under "Other".
  const { results: items } = await c.env.DB.prepare(
    `SELECT si.id, si.file_name, si.mime_type, si.caption, i.item_key
     FROM showcase_items si
     LEFT JOIN items i ON i.id = si.source_item_id
     WHERE si.user_id = ? ORDER BY si.created_at ASC`
  )
    .bind(profile.id)
    .all();

  // Never leak the raw R2 key — just whether one exists, so the frontend
  // knows whether to request /showcase/:userId/cover at all.
  const { showcase_cover_r2_key, ...publicProfile } = profile;
  return c.json({ profile: { ...publicProfile, hasCover: !!showcase_cover_r2_key }, items });
});

showcase.get('/showcase/:userId/cover', async (c) => {
  const param = c.req.param('userId');
  const profile = await c.env.DB.prepare('SELECT showcase_cover_r2_key FROM users WHERE id = ? OR showcase_slug = ?')
    .bind(param, param)
    .first<{ showcase_cover_r2_key: string | null }>();
  if (!profile?.showcase_cover_r2_key) return c.json({ error: 'not_found' }, 404);

  const object = await c.env.MEDIA.get(profile.showcase_cover_r2_key);
  if (!object) return c.json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    headers: { 'Content-Type': object.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
  });
});

// Parses a standard "bytes=start-end" Range header ourselves (rather than
// trusting R2's own Headers-based range resolution — its returned
// object.range came back with an unusable offset in testing) so we control
// exactly what gets requested from R2 and what Content-Range we report back.
function parseByteRange(rangeHeader: string | undefined, size: number): { offset: number; length: number } | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return null;
  let start: number;
  let end: number;
  if (startStr === '') {
    const suffixLength = Number(endStr);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0) return null;
  return { offset: start, length: end - start + 1 };
}
// Video (and, incidentally, large images) served without honoring Range
// requests silently breaks two things: iOS Safari refuses to load ANY
// <video> element at all unless the server's first response is a real 206
// with Content-Range (it always probes with a Range request before playing
// anything), and the client-side thumbnail-capture step's video.currentTime
// seek can hang forever waiting for a byte range that never arrives.
showcase.get('/showcase-items/:itemId/file', async (c) => {
  const item = await c.env.DB.prepare('SELECT r2_key, mime_type, size_bytes FROM showcase_items WHERE id = ?')
    .bind(c.req.param('itemId'))
    .first<{ r2_key: string; mime_type: string; size_bytes: number }>();
  if (!item) return c.json({ error: 'not_found' }, 404);

  const headers = new Headers({
    'Content-Type': item.mime_type || 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
    'Accept-Ranges': 'bytes',
  });

  const range = parseByteRange(c.req.header('Range'), item.size_bytes);
  if (range) {
    const object = await c.env.MEDIA.get(item.r2_key, { range: { offset: range.offset, length: range.length } });
    if (!object) return c.json({ error: 'not_found' }, 404);
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${item.size_bytes}`);
    headers.set('Content-Length', String(range.length));
    return new Response(object.body, { status: 206, headers });
  }

  const object = await c.env.MEDIA.get(item.r2_key);
  if (!object) return c.json({ error: 'not_found' }, 404);
  headers.set('Content-Length', String(item.size_bytes));
  return new Response(object.body, { headers });
});

showcase.get('/showcase-items/:itemId/thumbnail', async (c) => {
  const item = await c.env.DB.prepare('SELECT thumbnail_r2_key FROM showcase_items WHERE id = ?')
    .bind(c.req.param('itemId'))
    .first<{ thumbnail_r2_key: string | null }>();
  if (!item?.thumbnail_r2_key) return c.json({ error: 'not_found' }, 404);

  const object = await c.env.MEDIA.get(item.thumbnail_r2_key);
  if (!object) return c.json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
  });
});

export default showcase;
