import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/auth';

const assets = new Hono<{ Bindings: Bindings }>();

const MB = 1024 * 1024;

// Mirrors src/lib/uploadLimits.ts on the frontend. Client-side checks are only
// UX — this is the real gate, since a client can always be bypassed.
const LIMITS: Record<string, { maxBytes: number; accept: string[] }> = {
  logo: { maxBytes: 10 * MB, accept: ['image/png', 'image/jpeg', 'image/svg+xml'] },
  product_file: { maxBytes: 50 * MB, accept: ['image/png', 'image/jpeg', 'video/mp4'] },
  reference_file: { maxBytes: 50 * MB, accept: ['image/png', 'image/jpeg', 'video/mp4', 'application/pdf'] },
  output: { maxBytes: 500 * MB, accept: ['video/mp4', 'video/quicktime', 'image/png', 'image/jpeg', 'application/pdf'] },
  // Clarification-message attachments — same file rules as reference_file,
  // but a distinct type so it has its own count budget (see below): otherwise
  // it'd fight the brief's own reference_file uploads for the same 5-file cap.
  clarification: { maxBytes: 50 * MB, accept: ['image/png', 'image/jpeg', 'video/mp4', 'application/pdf'] },
};

// Per-message attachment count (max 2) is enforced when the comment is
// created (see requests.ts), not here — so clarification uploads skip the
// per-request count cap entirely, same as delivered outputs.
const UNCOUNTED_TYPES = new Set(['output', 'clarification']);

// TODO: files near/over ~100MB (delivered videos can run up to 500MB) should
// bypass this Worker via a true presigned R2 PUT URL issued through R2's
// S3-compatible API, so the browser uploads directly to storage. This route
// streams through the Worker, which is fine for logos/photos/reference files
// but is a known scaling gap for large video uploads.
assets.put('/:requestId/:type/:filename', async (c) => {
  const uploaderId = currentUserId(c);
  if (!uploaderId) return c.json({ error: 'unauthenticated' }, 401);

  const { requestId, type, filename } = c.req.param();
  const limits = LIMITS[type];
  if (!limits) return c.json({ error: 'invalid_type' }, 400);

  const contentType = c.req.header('Content-Type') ?? 'application/octet-stream';
  if (!limits.accept.includes(contentType)) {
    return c.json({ error: 'unsupported_type', allowed: limits.accept }, 415);
  }

  const contentLength = Number(c.req.header('Content-Length') ?? 0);
  if (contentLength > limits.maxBytes) {
    return c.json({ error: 'file_too_large', maxBytes: limits.maxBytes }, 413);
  }

  const owner = await c.env.DB.prepare('SELECT customer_id FROM requests WHERE id = ?')
    .bind(requestId)
    .first<{ customer_id: string }>();
  if (!owner) return c.json({ error: 'not_found' }, 404);

  if (!UNCOUNTED_TYPES.has(type)) {
    const { count } = (await c.env.DB.prepare('SELECT COUNT(*) AS count FROM request_assets WHERE request_id = ? AND type = ?')
      .bind(requestId, type)
      .first<{ count: number }>())!;
    const maxCount = type === 'logo' ? 1 : 5;
    if (count >= maxCount) return c.json({ error: 'too_many_files', maxCount }, 400);
  }

  const key = UNCOUNTED_TYPES.has(type)
    ? `${type === 'output' ? 'deliveries' : 'clarifications'}/${requestId}/${filename}`
    : `uploads/${owner.customer_id}/${requestId}/${type}/${filename}`;

  await c.env.ASSETS.put(key, c.req.raw.body, { httpMetadata: { contentType } });

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO request_assets (id, request_id, type, r2_key, file_name, mime_type, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, requestId, type, key, filename, contentType, contentLength, uploaderId).run();

  return c.json({ id, key });
});

async function loadAssetForAccess(c: { env: { DB: D1Database } }, assetId: string) {
  return c.env.DB.prepare(
    `SELECT a.id, a.r2_key, a.mime_type, a.file_name, r.customer_id, r.designer_id
     FROM request_assets a JOIN requests r ON r.id = a.request_id
     WHERE a.id = ?`
  ).bind(assetId).first<{ id: string; r2_key: string; mime_type: string; file_name: string; customer_id: string; designer_id: string }>();
}

assets.get('/:assetId/file', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const asset = await loadAssetForAccess(c, c.req.param('assetId'));
  if (!asset) return c.json({ error: 'not_found' }, 404);
  if (asset.customer_id !== userId && asset.designer_id !== userId) return c.json({ error: 'forbidden' }, 403);

  const object = await c.env.ASSETS.get(asset.r2_key);
  if (!object) return c.json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': asset.mime_type || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

assets.delete('/:assetId', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const asset = await loadAssetForAccess(c, c.req.param('assetId'));
  if (!asset) return c.json({ error: 'not_found' }, 404);
  if (asset.customer_id !== userId && asset.designer_id !== userId) return c.json({ error: 'forbidden' }, 403);

  await c.env.ASSETS.delete(asset.r2_key);
  await c.env.DB.prepare('DELETE FROM request_assets WHERE id = ?').bind(asset.id).run();
  return c.json({ ok: true });
});

export default assets;
