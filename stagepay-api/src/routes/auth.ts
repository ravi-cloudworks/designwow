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
  const user = await c.env.DB.prepare(
    `SELECT id, email, name, avatar_url, upi_id, showcase_slug, contact_link,
            status, role, instagram_url, youtube_url, ugc_description, free_credits_remaining
     FROM users WHERE id = ?`
  )
    .bind(sessionUserId)
    .first();
  return c.json({ user: user ?? null });
});

// Waitlist application — submitted once to move from 'pending_profile' to
// 'waitlisted', but re-callable while still 'waitlisted' so a designer can
// edit their answers before you review them. Not allowed once 'approved' —
// there's nothing left to apply for at that point.
auth.post('/me/apply', async (c) => {
  const sessionUserId = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
  if (!sessionUserId) return c.json({ error: 'unauthenticated' }, 401);

  const user = await c.env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(sessionUserId).first<{ status: string }>();
  if (!user) return c.json({ error: 'not_found' }, 404);
  if (user.status === 'approved') return c.json({ error: 'already_approved' }, 400);

  const body = await c.req
    .json<{ name?: string; role?: string; instagramUrl?: string; youtubeUrl?: string; ugcDescription?: string }>()
    .catch(() => ({}) as { name?: string; role?: string; instagramUrl?: string; youtubeUrl?: string; ugcDescription?: string });

  const name = (body.name || '').trim();
  const role = (body.role || '').trim();
  const instagramUrl = (body.instagramUrl || '').trim();
  const youtubeUrl = (body.youtubeUrl || '').trim();
  const ugcDescription = (body.ugcDescription || '').trim();

  if (!name) return c.json({ error: 'name_required', message: 'Name cannot be empty.' }, 400);
  if (!role) return c.json({ error: 'role_required', message: 'Please select what best describes you.' }, 400);
  if (!/^https?:\/\//i.test(instagramUrl)) {
    return c.json({ error: 'instagram_required', message: 'Please share your Instagram profile URL.' }, 400);
  }
  if (youtubeUrl && !/^https?:\/\//i.test(youtubeUrl)) {
    return c.json({ error: 'invalid_youtube_url', message: 'That doesn’t look like a valid YouTube URL.' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE users
     SET name = ?, role = ?, instagram_url = ?, youtube_url = ?, ugc_description = ?,
         status = 'waitlisted', applied_at = COALESCE(applied_at, datetime('now'))
     WHERE id = ?`
  )
    .bind(name.slice(0, 100), role.slice(0, 50), instagramUrl.slice(0, 300), youtubeUrl.slice(0, 300) || null, ugcDescription.slice(0, 200) || null, sessionUserId)
    .run();

  return c.json({ ok: true });
});

// 3-30 lowercase letters/numbers/hyphens, no leading/trailing hyphen — a
// short, URL-safe handle, distinct from the designer's display name (which
// can collide across designers and often has characters that don't belong
// in a URL).
const SHOWCASE_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

// Restricted to http(s) deliberately — this value is rendered as a raw href
// on the public showcase page, so anything other than a real link (e.g. a
// javascript: URI) must be rejected here, not just HTML-escaped. mailto: was
// dropped — this is meant for a social/profile URL, not an email address.
const CONTACT_LINK_RE = /^https?:\/\//i;

// Loose UPI VPA shape: handle@bank-or-psp, e.g. 9876543210@ybl or
// name@okhdfcbank. Not exhaustive of every real PSP suffix — just enough to
// catch empty/garbage/typo'd values before they get saved.
const UPI_ID_RE = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;

auth.patch('/me', async (c) => {
  const sessionUserId = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
  if (!sessionUserId) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req
    .json<{ name?: string; upiId?: string; showcaseSlug?: string | null; contactLink?: string | null }>()
    .catch(() => ({}) as { name?: string; upiId?: string; showcaseSlug?: string | null; contactLink?: string | null });
  if (body.name === undefined && body.upiId === undefined && body.showcaseSlug === undefined && body.contactLink === undefined) {
    return c.json({ error: 'nothing_to_update' }, 400);
  }

  // Only ever set once at signup, from the Google profile at the time —
  // never editable since, even though a Google account's display name can
  // be wrong or change later. Same validation-free trim as showcase items'
  // own name field; a display name has no format to enforce beyond "not empty".
  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) return c.json({ error: 'name_required', message: 'Name cannot be empty.' }, 400);
    await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(trimmed.slice(0, 100), sessionUserId).run();
  }

  if (body.upiId !== undefined) {
    const trimmedUpi = body.upiId.trim();
    // Clearing it (e.g. temporarily, while switching banks) stays allowed —
    // only a non-empty value has to actually look like a UPI ID.
    if (trimmedUpi && !UPI_ID_RE.test(trimmedUpi)) {
      return c.json({ error: 'invalid_upi_id', message: 'That doesn’t look like a valid UPI ID — expected format: name@bank.' }, 400);
    }
    await c.env.DB.prepare('UPDATE users SET upi_id = ? WHERE id = ?').bind(trimmedUpi, sessionUserId).run();
  }

  if (body.showcaseSlug !== undefined) {
    const trimmed = (body.showcaseSlug || '').trim().toLowerCase();
    if (trimmed === '') {
      // Clearing it back to the UUID-based URL — always valid, no uniqueness to check.
      await c.env.DB.prepare('UPDATE users SET showcase_slug = NULL WHERE id = ?').bind(sessionUserId).run();
    } else {
      if (!SHOWCASE_SLUG_RE.test(trimmed)) {
        return c.json({ error: 'invalid_slug', message: 'Use 3-30 lowercase letters, numbers, or hyphens — no spaces or symbols.' }, 400);
      }
      try {
        await c.env.DB.prepare('UPDATE users SET showcase_slug = ? WHERE id = ?').bind(trimmed, sessionUserId).run();
      } catch {
        // Only failure mode here is the UNIQUE index — someone else already has this slug.
        return c.json({ error: 'slug_taken', message: 'That link is already taken — try another.' }, 409);
      }
    }
  }

  if (body.contactLink !== undefined) {
    const trimmed = (body.contactLink || '').trim();
    if (trimmed === '') {
      await c.env.DB.prepare('UPDATE users SET contact_link = NULL WHERE id = ?').bind(sessionUserId).run();
    } else if (!CONTACT_LINK_RE.test(trimmed)) {
      return c.json({ error: 'invalid_contact_link', message: 'Must be a link starting with https:// or http:// — e.g. your Instagram, LinkedIn, or website URL.' }, 400);
    } else {
      await c.env.DB.prepare('UPDATE users SET contact_link = ? WHERE id = ?').bind(trimmed, sessionUserId).run();
    }
  }

  return c.json({ ok: true });
});

auth.post('/logout', (c) => {
  c.header('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  return c.json({ ok: true });
});

export default auth;
