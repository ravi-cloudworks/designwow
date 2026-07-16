import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

const media = new Hono<{ Bindings: Bindings }>();

async function projectBelongsToUser(db: D1Database, projectId: string, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT user_id FROM projects WHERE id = ?').bind(projectId).first<{ user_id: string }>();
  return !!row && row.user_id === userId;
}

// Raw bytes in the body (not multipart — simplest thing that works from a
// plain fetch(file) call), fileName/projectId as query params. The R2 key
// embeds the owning user id as its first segment, so the download route can
// verify ownership without a separate metadata table.
media.post('/media', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const projectId = c.req.query('projectId') || '';
  const fileName = c.req.query('fileName') || 'file';
  if (!projectId) return c.json({ error: 'projectId_required' }, 400);
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  const contentType = c.req.header('Content-Type') || 'application/octet-stream';
  const body = await c.req.arrayBuffer();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${userId}/${projectId}/${crypto.randomUUID()}-${safeName}`;
  await c.env.MEDIA.put(key, body, { httpMetadata: { contentType } });
  return c.json({ key, fileName }, 201);
});

media.get('/media/:key{.+}', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const key = c.req.param('key');
  if (!key.startsWith(`${userId}/`)) return c.json({ error: 'forbidden' }, 403);
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

export default media;
