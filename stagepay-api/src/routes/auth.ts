import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';

const auth = new Hono<{ Bindings: Bindings }>();

auth.get('/google', (c) => {
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: c.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'missing_code' }, 400);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: c.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    return c.json({ error: 'token_exchange_failed', detail: detail.slice(0, 500) }, 502);
  }
  const { id_token } = await tokenRes.json<{ id_token: string }>();

  // Same as design-wow-api: decoding without verifying the id_token's
  // signature is a known scaffold limitation, not something to fix here.
  const payload = JSON.parse(atob(id_token.split('.')[1])) as {
    sub: string;
    email: string;
    name: string;
    picture?: string;
  };

  const existing = await c.env.DB.prepare('SELECT * FROM users WHERE google_id = ?').bind(payload.sub).first();

  let user = existing;
  if (!user) {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO users (id, google_id, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, payload.sub, payload.email, payload.name, payload.picture ?? null)
      .run();
    user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  }

  c.header('Set-Cookie', `session=${user!.id}; HttpOnly; Secure; SameSite=Lax; Path=/`);
  return c.redirect(c.env.FRONTEND_ORIGIN);
});

auth.get('/me', async (c) => {
  const sessionUserId = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
  if (!sessionUserId) return c.json({ user: null });
  const user = await c.env.DB.prepare('SELECT id, email, name, avatar_url, upi_id FROM users WHERE id = ?')
    .bind(sessionUserId)
    .first();
  return c.json({ user: user ?? null });
});

auth.patch('/me', async (c) => {
  const sessionUserId = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
  if (!sessionUserId) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req.json<{ upiId?: string }>().catch(() => ({}) as { upiId?: string });
  if (body.upiId === undefined) return c.json({ error: 'nothing_to_update' }, 400);
  await c.env.DB.prepare('UPDATE users SET upi_id = ? WHERE id = ?').bind(body.upiId, sessionUserId).run();
  return c.json({ ok: true });
});

auth.post('/logout', (c) => {
  c.header('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  return c.json({ ok: true });
});

export default auth;
