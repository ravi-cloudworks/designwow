import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';

const auth = new Hono<{ Bindings: Bindings }>();

auth.get('/google', (c) => {
  // Round-trips the intended post-login destination (e.g. a public designer
  // page's "Send a request" CTA linking to /new?designer=X) through Google's
  // state param, since Google itself doesn't know or care about it.
  const redirect = c.req.query('redirect');
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: c.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    ...(redirect ? { state: redirect } : {}),
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

  if (!tokenRes.ok) return c.json({ error: 'token_exchange_failed' }, 502);
  const { id_token } = await tokenRes.json<{ id_token: string }>();

  // TODO: verify id_token's signature against Google's JWKS before trusting the
  // payload. Decoding without verification is fine for local scaffolding only.
  const payload = JSON.parse(atob(id_token.split('.')[1])) as {
    sub: string;
    email: string;
    name: string;
    picture?: string;
  };

  const existing = await c.env.DB.prepare('SELECT * FROM users WHERE google_id = ?')
    .bind(payload.sub)
    .first();

  let user = existing;
  if (!user) {
    // New sign-ins default to 'customer'. Designer accounts are provisioned
    // manually (there's no self-serve designer signup in this product).
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, name, avatar_url, role, google_id) VALUES (?, ?, ?, ?, 'customer', ?)`
    ).bind(id, payload.email, payload.name, payload.picture ?? null, payload.sub).run();
    user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  }

  // TODO: replace this plain cookie with a signed session (JWT via SESSION_SECRET,
  // or an opaque token backed by a sessions table) before shipping past scaffold.
  // SameSite=Lax is safe here because the browser only ever talks to
  // designwow.pages.dev (the Pages Function proxies /api/* to this
  // Worker server-side) — the cookie is first-party, not cross-site.
  c.header('Set-Cookie', `session=${user!.id}; HttpOnly; Secure; SameSite=Lax; Path=/`);

  // Only ever follow a same-site relative path from state (never an absolute
  // URL) — this is an open-redirect vector otherwise.
  const state = c.req.query('state');
  const redirectPath = state && state.startsWith('/') && !state.startsWith('//') ? state : '';
  return c.redirect(`${c.env.FRONTEND_ORIGIN}${redirectPath}`);
});

auth.get('/me', async (c) => {
  const sessionUserId = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
  if (!sessionUserId) return c.json({ user: null });

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, avatar_url, role FROM users WHERE id = ?'
  ).bind(sessionUserId).first();

  return c.json({ user: user ?? null });
});

auth.post('/logout', (c) => {
  c.header('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  return c.json({ ok: true });
});

export default auth;
