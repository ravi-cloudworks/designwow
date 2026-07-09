import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/auth';

const users = new Hono<{ Bindings: Bindings }>();

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_ACCEPT = ['image/png', 'image/jpeg'];

users.put('/me/avatar', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const contentType = c.req.header('Content-Type') ?? '';
  if (!AVATAR_ACCEPT.includes(contentType)) return c.json({ error: 'unsupported_type', allowed: AVATAR_ACCEPT }, 415);

  const contentLength = Number(c.req.header('Content-Length') ?? 0);
  if (contentLength > AVATAR_MAX_BYTES) return c.json({ error: 'file_too_large', maxBytes: AVATAR_MAX_BYTES }, 413);

  // Single fixed key per user (no filename) — a new upload just overwrites
  // the last one, so there's never more than one photo lingering in R2.
  const key = `avatars/${userId}/photo`;
  await c.env.ASSETS.put(key, c.req.raw.body, { httpMetadata: { contentType } });

  const avatarUrl = `/api/users/${userId}/avatar-file`;
  await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatarUrl, userId).run();

  return c.json({ avatarUrl });
});

// No auth — a profile photo isn't sensitive, and it needs to be visible on
// public pages (the homepage's designer list, a designer's own public
// showcase page), both viewed by anonymous visitors.
users.get('/:id/avatar-file', async (c) => {
  const object = await c.env.ASSETS.get(`avatars/${c.req.param('id')}/photo`);
  if (!object) return c.json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

export default users;
