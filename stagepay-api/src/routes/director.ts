import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

// Director purchase requests — same manual UTR + admin-approval pattern as
// credits.ts (no payment gateway yet). Discounted duration tiers rather than
// flat per-month pricing, to reward a longer upfront commitment: 1mo=₹299,
// 3mo=₹279/mo, 6mo=₹249/mo, 12mo=₹199/mo. This route only ever creates the
// pending request — admin.ts's approval is what actually grants access.
const director = new Hono<{ Bindings: Bindings }>();

const DIRECTOR_TIERS: Record<number, number> = { 1: 29900, 3: 83700, 6: 149400, 12: 238800 };

director.get('/director', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const user = await c.env.DB.prepare('SELECT has_director_access, director_access_until FROM users WHERE id = ?')
    .bind(userId)
    .first<{ has_director_access: number; director_access_until: string | null }>();

  const admin = await c.env.DB.prepare('SELECT upi_id FROM users WHERE email = ?')
    .bind(c.env.ADMIN_EMAIL)
    .first<{ upi_id: string }>();

  const { results: requests } = await c.env.DB.prepare(
    `SELECT id, months, amount_paise, status, created_at, resolved_at, reject_reason, previous_access_until, new_access_until
     FROM director_purchase_requests WHERE user_id = ? ORDER BY created_at DESC`
  )
    .bind(userId)
    .all();

  return c.json({
    hasDirectorAccess: !!user?.has_director_access,
    directorAccessUntil: user?.director_access_until ?? null,
    adminUpiId: admin?.upi_id || '',
    requests,
  });
});

director.post('/director/purchase-request', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const body = await c.req.json<{ months?: number; utr?: string }>().catch(() => ({}) as { months?: number; utr?: string });
  const months = Number(body.months);
  const utr = (body.utr || '').trim();

  if (!DIRECTOR_TIERS[months]) return c.json({ error: 'invalid_months', message: 'Choose 1, 3, 6, or 12 months.' }, 400);
  if (!utr) return c.json({ error: 'utr_required', message: 'Enter the UTR / reference number from your payment.' }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO director_purchase_requests (id, user_id, months, amount_paise, utr) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, userId, months, DIRECTOR_TIERS[months], utr.slice(0, 100))
    .run();

  return c.json({ id }, 201);
});

// Same "fix a wrong UTR, no new payment" recovery as credits.ts's own
// resubmit route — same row, back to 'pending', rejection reason cleared.
director.post('/director/purchase-request/:id/resubmit-utr', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const body = await c.req.json<{ utr?: string }>().catch(() => ({}) as { utr?: string });
  const utr = (body.utr || '').trim();
  if (!utr) return c.json({ error: 'utr_required', message: 'Enter the UTR / reference number from your payment.' }, 400);

  const result = await c.env.DB.prepare(
    "UPDATE director_purchase_requests SET utr = ?, status = 'pending', resolved_at = NULL, reject_reason = NULL WHERE id = ? AND user_id = ? AND status = 'rejected'"
  )
    .bind(utr.slice(0, 100), id, userId)
    .run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

export default director;
