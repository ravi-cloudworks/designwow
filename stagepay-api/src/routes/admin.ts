import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

// Single-admin gate — no roles table, just the session's own email checked
// against one env var. Fine for one reviewer; would need a real roles
// system the moment a second person needs access.
const admin = new Hono<{ Bindings: Bindings }>();

admin.use('*', async (c, next) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  if (!user || user.email !== c.env.ADMIN_EMAIL) return c.json({ error: 'forbidden' }, 403);
  await next();
});

admin.get('/admin/waitlist', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, email, role, instagram_url, youtube_url, ugc_description, applied_at
     FROM users WHERE status = 'waitlisted' ORDER BY applied_at ASC`
  ).all();
  return c.json({ applicants: results });
});

admin.post('/admin/waitlist/:userId/approve', async (c) => {
  const userId = c.req.param('userId');
  const result = await c.env.DB.prepare(
    `UPDATE users SET status = 'approved', free_credits_remaining = 10, approved_at = datetime('now')
     WHERE id = ? AND status = 'waitlisted'`
  )
    .bind(userId)
    .run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

admin.get('/admin/credit-requests', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cpr.id, cpr.pack_size, cpr.amount_paise, cpr.utr, cpr.created_at, u.name AS user_name, u.email AS user_email
     FROM credit_purchase_requests cpr JOIN users u ON u.id = cpr.user_id
     WHERE cpr.status = 'pending' ORDER BY cpr.created_at ASC`
  ).all();
  return c.json({ requests: results });
});

admin.post('/admin/credit-requests/:id/approve', async (c) => {
  const id = c.req.param('id');
  const request = await c.env.DB.prepare("SELECT user_id, pack_size FROM credit_purchase_requests WHERE id = ? AND status = 'pending'")
    .bind(id)
    .first<{ user_id: string; pack_size: number }>();
  if (!request) return c.json({ error: 'not_found' }, 404);

  await c.env.DB.prepare('UPDATE users SET free_credits_remaining = free_credits_remaining + ? WHERE id = ?')
    .bind(request.pack_size, request.user_id)
    .run();
  await c.env.DB.prepare("UPDATE credit_purchase_requests SET status = 'approved', resolved_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();

  return c.json({ ok: true });
});

admin.post('/admin/credit-requests/:id/reject', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare("UPDATE credit_purchase_requests SET status = 'rejected', resolved_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .bind(id)
    .run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

export default admin;
