import { Hono } from 'hono';
import { currentUserId } from '../lib/auth';
const subscriptions = new Hono();
subscriptions.get('/me', async (c) => {
    const userId = currentUserId(c);
    if (!userId)
        return c.json({ error: 'unauthenticated' }, 401);
    const subscription = await c.env.DB.prepare(`SELECT * FROM subscriptions WHERE customer_id = ? AND status != 'cancelled' ORDER BY started_at DESC LIMIT 1`).bind(userId).first();
    return c.json({ subscription: subscription ?? null });
});
subscriptions.patch('/me', async (c) => {
    // Switches plan tier. Real payment-amount changes belong to Dodo Payments
    // once that's wired up — this only updates our own record of the plan.
    const userId = currentUserId(c);
    if (!userId)
        return c.json({ error: 'unauthenticated' }, 401);
    const { planTier } = await c.req.json();
    const slaHours = planTier === 'priority' ? 48 : 78;
    const amountPaise = planTier === 'priority' ? 699900 : 299900;
    await c.env.DB.prepare(`UPDATE subscriptions SET plan_tier = ?, sla_hours = ?, amount_paise = ?
     WHERE customer_id = ? AND status != 'cancelled'`).bind(planTier, slaHours, amountPaise, userId).run();
    return c.json({ ok: true });
});
export default subscriptions;
