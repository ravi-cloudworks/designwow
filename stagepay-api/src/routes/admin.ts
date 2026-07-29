import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

// Single-admin gate — no roles table, just the session's own email checked
// against one env var. Fine for one reviewer; would need a real roles
// system the moment a second person needs access.
const admin = new Hono<{ Bindings: Bindings }>();

admin.use('*', async (c, next) => {
  const userId = await currentUserId(c);
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

// Same three entitlement fields as POST /admin/users/:userId/entitlements,
// set at the moment of approval instead of needing a separate follow-up
// visit to the Users tab. accessUntil is one shared date applied to
// BOTH stagepay_access_until and (only if hasDirectorAccess)
// director_access_until — the admin UI can still split them apart
// independently afterward from the Users tab if needed.
admin.post('/admin/waitlist/:userId/approve', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req
    .json<{ freeCredits?: number; hasDirectorAccess?: boolean; accessUntil?: string | null }>()
    .catch(() => ({}) as { freeCredits?: number; hasDirectorAccess?: boolean; accessUntil?: string | null });
  const freeCredits = Number.isFinite(body.freeCredits) && (body.freeCredits as number) > 0 ? Math.floor(body.freeCredits as number) : 10;
  const hasDirectorAccess = body.hasDirectorAccess ? 1 : 0;
  const accessUntil = body.accessUntil || null;
  const result = await c.env.DB.prepare(
    `UPDATE users
     SET status = 'approved', free_credits_remaining = ?, has_director_access = ?,
         stagepay_access_until = ?, director_access_until = ?, approved_at = datetime('now')
     WHERE id = ? AND status = 'waitlisted'`
  )
    .bind(freeCredits, hasDirectorAccess, accessUntil, hasDirectorAccess ? accessUntil : null, userId)
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

admin.get('/admin/director-requests', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT dpr.id, dpr.months, dpr.amount_paise, dpr.utr, dpr.created_at, u.name AS user_name, u.email AS user_email
     FROM director_purchase_requests dpr JOIN users u ON u.id = dpr.user_id
     WHERE dpr.status = 'pending' ORDER BY dpr.created_at ASC`
  ).all();
  return c.json({ requests: results });
});

// Extends from the existing director_access_until if it's still in the
// future (an early renewal — no already-paid time is lost), otherwise from
// today (lapsed or never had it). Always sets has_director_access = 1,
// even for a renewal on an account that had temporarily let it lapse.
admin.post('/admin/director-requests/:id/approve', async (c) => {
  const id = c.req.param('id');
  const request = await c.env.DB.prepare("SELECT user_id, months FROM director_purchase_requests WHERE id = ? AND status = 'pending'")
    .bind(id)
    .first<{ user_id: string; months: number }>();
  if (!request) return c.json({ error: 'not_found' }, 404);

  const user = await c.env.DB.prepare('SELECT director_access_until FROM users WHERE id = ?')
    .bind(request.user_id)
    .first<{ director_access_until: string | null }>();
  const today = new Date().toISOString().slice(0, 10);
  const base = user?.director_access_until && user.director_access_until > today ? new Date(`${user.director_access_until}T00:00:00`) : new Date();
  base.setMonth(base.getMonth() + request.months);
  const newUntil = base.toISOString().slice(0, 10);

  await c.env.DB.prepare('UPDATE users SET has_director_access = 1, director_access_until = ? WHERE id = ?')
    .bind(newUntil, request.user_id)
    .run();
  await c.env.DB.prepare("UPDATE director_purchase_requests SET status = 'approved', resolved_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();

  return c.json({ ok: true, directorAccessUntil: newUntil });
});

admin.post('/admin/director-requests/:id/reject', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare("UPDATE director_purchase_requests SET status = 'rejected', resolved_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .bind(id)
    .run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

// Approved users only — waitlisted/pending applicants have nothing to
// entitle yet (they show up in the Waitlist tab instead).
admin.get('/admin/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, email, free_credits_remaining, has_director_access, stagepay_access_until, director_access_until, suspended
     FROM users WHERE status = 'approved' ORDER BY name ASC`
  ).all();
  return c.json({ users: results });
});

// One combined endpoint for all three entitlement fields — only whichever
// keys are present in the body get updated, so the admin UI can save a
// single field (e.g. just the Director toggle) without needing to resend
// the other two untouched.
admin.post('/admin/users/:userId/entitlements', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req
    .json<{ hasDirectorAccess?: boolean; stagepayAccessUntil?: string | null; directorAccessUntil?: string | null }>()
    .catch(() => ({}) as { hasDirectorAccess?: boolean; stagepayAccessUntil?: string | null; directorAccessUntil?: string | null });

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  if (body.hasDirectorAccess !== undefined) { sets.push('has_director_access = ?'); binds.push(body.hasDirectorAccess ? 1 : 0); }
  if (body.stagepayAccessUntil !== undefined) { sets.push('stagepay_access_until = ?'); binds.push(body.stagepayAccessUntil || null); }
  if (body.directorAccessUntil !== undefined) { sets.push('director_access_until = ?'); binds.push(body.directorAccessUntil || null); }
  if (!sets.length) return c.json({ error: 'nothing_to_update' }, 400);

  binds.push(userId);
  const result = await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND status = 'approved'`).bind(...binds).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

// Deliberately separate from the entitlements route above — suspension is a
// blunt, immediate kill switch (index.ts's global middleware blocks the
// account's own session right away; showcase.ts/pay.ts pause their public
// pages, including already-live ones), not a graceful expiry, so it isn't
// folded in alongside the two access-until dates.
admin.post('/admin/users/:userId/suspend', async (c) => {
  const userId = c.req.param('userId');
  // Suspending yourself would lock you out immediately (index.ts's global
  // middleware blocks a suspended session's own API access with no
  // exception for admins) with no way back in except a direct DB edit —
  // guard against it here rather than relying on the admin UI alone never
  // offering it by mistake.
  const callerId = await currentUserId(c);
  if (userId === callerId) return c.json({ error: 'cannot_suspend_self' }, 400);
  // Belt-and-suspenders on top of the id check above: refuses by email
  // against the CURRENT ADMIN_EMAIL binding, not just "is this the caller's
  // own id" — still correct if ADMIN_EMAIL is ever rotated to a different
  // account, and correct even if this route is ever reachable some other
  // way in the future (a second admin, a script, etc.) that isn't just "the
  // logged-in admin clicking their own row."
  const target = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  if (target && target.email === c.env.ADMIN_EMAIL) return c.json({ error: 'cannot_suspend_admin' }, 400);
  const result = await c.env.DB.prepare("UPDATE users SET suspended = 1 WHERE id = ? AND status = 'approved'").bind(userId).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

admin.post('/admin/users/:userId/unsuspend', async (c) => {
  const userId = c.req.param('userId');
  const result = await c.env.DB.prepare('UPDATE users SET suspended = 0 WHERE id = ?').bind(userId).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

export default admin;
