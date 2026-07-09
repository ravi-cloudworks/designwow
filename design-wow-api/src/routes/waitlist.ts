import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';

const waitlist = new Hono<{ Bindings: Bindings }>();

// Public — no self-serve signup yet, so "Get Started" on the homepage just
// captures a lead here for manual review and onboarding.
waitlist.post('/', async (c) => {
  const { role, name, email, details } = await c.req.json<{
    role?: string;
    name?: string;
    email?: string;
    details?: string;
  }>();

  if (role !== 'customer' && role !== 'designer') return c.json({ error: 'invalid_role' }, 400);
  if (!name?.trim() || !email?.trim()) return c.json({ error: 'missing_fields' }, 400);

  const normalizedEmail = email.trim().toLowerCase();

  // Same email can join both the customer and designer waitlists (a
  // reasonable dual persona), but not the same one twice.
  const existing = await c.env.DB.prepare(
    'SELECT id FROM waitlist_signups WHERE role = ? AND lower(email) = ?'
  ).bind(role, normalizedEmail).first();
  if (existing) return c.json({ ok: true, alreadyOnList: true });

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO waitlist_signups (id, role, name, email, details) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, role, name.trim(), email.trim(), details?.trim() || null).run();

  return c.json({ ok: true, alreadyOnList: false }, 201);
});

export default waitlist;
