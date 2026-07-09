import { Hono } from 'hono';
import { currentUserId } from '../lib/auth';
const designers = new Hono();
designers.get('/', async (c) => {
    const { results } = await c.env.DB.prepare(`SELECT u.id, u.name, u.avatar_url, d.bio, d.specialty_tags
     FROM designer_profiles d
     JOIN users u ON u.id = d.user_id
     WHERE d.active = 1`).all();
    return c.json({ designers: results });
});
designers.get('/me', async (c) => {
    const userId = currentUserId(c);
    if (!userId)
        return c.json({ error: 'unauthenticated' }, 401);
    const profile = await c.env.DB.prepare(`SELECT u.id, u.name, u.email, u.avatar_url, d.bio, d.specialty_tags, d.active
     FROM users u JOIN designer_profiles d ON d.user_id = u.id
     WHERE u.id = ?`).bind(userId).first();
    if (!profile)
        return c.json({ error: 'not_found' }, 404);
    const stats = await c.env.DB.prepare(`SELECT
       COUNT(*) AS delivered_count,
       AVG((julianday(delivered_at) - julianday(submitted_at)) * 86400 - total_paused_seconds) AS avg_turnaround_seconds,
       SUM(CASE WHEN delivered_at <= datetime(sla_deadline, '+' || total_paused_seconds || ' seconds') THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS on_time_rate
     FROM requests
     WHERE designer_id = ? AND delivered_at IS NOT NULL`).bind(userId).first();
    return c.json({ profile, stats });
});
designers.patch('/me', async (c) => {
    const userId = currentUserId(c);
    if (!userId)
        return c.json({ error: 'unauthenticated' }, 401);
    const { bio, specialtyTags, active } = await c.req.json();
    await c.env.DB.prepare(`UPDATE designer_profiles SET
       bio = COALESCE(?, bio),
       specialty_tags = COALESCE(?, specialty_tags),
       active = COALESCE(?, active)
     WHERE user_id = ?`).bind(bio ?? null, specialtyTags ? JSON.stringify(specialtyTags) : null, active === undefined ? null : active ? 1 : 0, userId).run();
    return c.json({ ok: true });
});
designers.get('/customers', async (c) => {
    const userId = currentUserId(c);
    if (!userId)
        return c.json({ error: 'unauthenticated' }, 401);
    const { results } = await c.env.DB.prepare(`SELECT cu.id, cu.name, cu.email,
            s.plan_tier, s.status AS subscription_status, s.amount_paise, s.started_at,
            COUNT(r.id) AS request_count,
            MAX(CASE WHEN r.status IN ('queued', 'in_progress', 'needs_info') THEN 1 ELSE 0 END) AS has_active_request
     FROM requests r
     JOIN users cu ON cu.id = r.customer_id
     JOIN subscriptions s ON s.id = r.subscription_id
     WHERE r.designer_id = ?
     GROUP BY cu.id
     ORDER BY s.started_at ASC`).bind(userId).all();
    // No payments ledger yet (Dodo Payments integration is a later phase), so
    // "amount paid" is an approximation: months active × the plan's monthly price.
    const customers = results.map((row) => {
        const monthsActive = Math.max(1, Math.round((Date.now() - Date.parse(`${row.started_at.replace(' ', 'T')}Z`)) / (1000 * 60 * 60 * 24 * 30)));
        return { ...row, approx_amount_paid_paise: monthsActive * row.amount_paise };
    });
    return c.json({ customers });
});
export default designers;
