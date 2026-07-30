import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

// Payment credits — no gateway involved. A designer pays the admin's own
// UPI ID directly (same self-attested pattern as everywhere else in this
// app) and submits the UTR here; an admin manually verifies and approves
// via the admin queue (see admin.ts), which is what actually credits the
// balance. This route only ever creates the pending request.
const credits = new Hono<{ Bindings: Bindings }>();

const CREDIT_PACKS: Record<number, number> = { 5: 24500, 10: 49000 };

credits.get('/credits', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const user = await c.env.DB.prepare('SELECT free_credits_remaining FROM users WHERE id = ?')
    .bind(userId)
    .first<{ free_credits_remaining: number }>();

  // The admin is just another row in this same table — their own upi_id
  // (already set via their own Settings, same as any designer) is what the
  // Buy Credits QR pays into. No separate secret/config needed for it.
  const admin = await c.env.DB.prepare('SELECT upi_id FROM users WHERE email = ?')
    .bind(c.env.ADMIN_EMAIL)
    .first<{ upi_id: string }>();

  const { results: requests } = await c.env.DB.prepare(
    `SELECT id, pack_size, amount_paise, status, created_at, resolved_at, reject_reason, previous_credits, new_credits
     FROM credit_purchase_requests WHERE user_id = ? ORDER BY created_at DESC`
  )
    .bind(userId)
    .all();

  return c.json({ freeCreditsRemaining: user?.free_credits_remaining ?? 0, adminUpiId: admin?.upi_id || '', requests });
});

credits.post('/credits/purchase-request', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const body = await c.req.json<{ packSize?: number; utr?: string }>().catch(() => ({}) as { packSize?: number; utr?: string });
  const packSize = Number(body.packSize);
  const utr = (body.utr || '').trim();

  if (!CREDIT_PACKS[packSize]) return c.json({ error: 'invalid_pack_size', message: 'Choose either the 5 or 10 credit pack.' }, 400);
  if (!utr) return c.json({ error: 'utr_required', message: 'Enter the UTR / reference number from your payment.' }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO credit_purchase_requests (id, user_id, pack_size, amount_paise, utr) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, userId, packSize, CREDIT_PACKS[packSize], utr.slice(0, 100))
    .run();

  return c.json({ id }, 201);
});

// Fixes a wrong/typo'd UTR on an already-paid request WITHOUT a new
// payment — a rejection doesn't necessarily mean the money never arrived,
// just that the admin couldn't match it against this reference number. Puts
// the SAME row back to 'pending' (same id, same pack/amount) rather than
// creating a new request, so there's exactly one record per real payment,
// and clears the old rejection reason since it no longer applies.
credits.post('/credits/purchase-request/:id/resubmit-utr', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const body = await c.req.json<{ utr?: string }>().catch(() => ({}) as { utr?: string });
  const utr = (body.utr || '').trim();
  if (!utr) return c.json({ error: 'utr_required', message: 'Enter the UTR / reference number from your payment.' }, 400);

  const result = await c.env.DB.prepare(
    "UPDATE credit_purchase_requests SET utr = ?, status = 'pending', resolved_at = NULL, reject_reason = NULL WHERE id = ? AND user_id = ? AND status = 'rejected'"
  )
    .bind(utr.slice(0, 100), id, userId)
    .run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

export default credits;
