export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  FRONTEND_ORIGIN: string;
  GEMINI_API_KEY?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  ADMIN_EMAIL: string;
  SESSION_SECRET: string;
};

// Session cookie is `<user_id>.<issued_at_epoch_seconds>.<hmac_hex>` — HMAC
// covers "<user_id>.<issued_at>", keyed on SESSION_SECRET (server-only, never
// shipped to any client). Fixes the previous plain `session=<user_id>`
// cookie: that value alone was the entire credential, so anything that ever
// exposed a raw user id (a log line capturing request headers, a careless
// admin view, a DB export) let anyone construct a working session for that
// user with no signature check at all. Signing means a forged cookie is
// rejected unless it was actually produced by this server; issued_at is
// embedded (not just left to the cookie's own Max-Age) so an old, copied
// cookie is rejected by the server itself even if replayed directly against
// the API rather than through a browser that would honor Max-Age.
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Builds the signed value to go after `session=` in Set-Cookie.
export async function signSessionValue(userId: string, secret: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${userId}.${issuedAt}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function currentUserId(c: {
  req: { header: (name: string) => string | undefined };
  env: { SESSION_SECRET: string };
}): Promise<string | null> {
  const raw = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null; // stale pre-signing cookie, or tampered
  const [userId, issuedAtStr, sig] = parts;
  const issuedAt = Number(issuedAtStr);
  if (!userId || !Number.isFinite(issuedAt)) return null;
  if (Math.floor(Date.now() / 1000) - issuedAt > SESSION_MAX_AGE_SECONDS) return null;
  const expectedSig = await hmacHex(c.env.SESSION_SECRET, `${userId}.${issuedAtStr}`);
  if (!timingSafeEqual(sig, expectedSig)) return null;
  return userId;
}

