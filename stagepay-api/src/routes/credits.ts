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
  const userId = currentUserId(c);
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
    'SELECT id, pack_size, amount_paise, status, created_at, resolved_at FROM credit_purchase_requests WHERE user_id = ? ORDER BY created_at DESC'
  )
    .bind(userId)
    .all();

  return c.json({ freeCreditsRemaining: user?.free_credits_remaining ?? 0, adminUpiId: admin?.upi_id || '', requests });
});

credits.post('/credits/purchase-request', async (c) => {
  const userId = currentUserId(c);
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

export default credits;
