import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

async function projectBelongsToUser(db: D1Database, projectId: string, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT user_id FROM projects WHERE id = ?').bind(projectId).first<{ user_id: string }>();
  return !!row && row.user_id === userId;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Every other datetime column in this DB is SQLite's own `datetime('now')`
// format ("YYYY-MM-DD HH:MM:SS", space-separated, no milliseconds/Z) — the
// frontend's formatIST() only knows how to parse that shape. A plain
// toISOString() produces a differently-shaped string that looks similar but
// silently fails to parse there, so this matches the existing convention.
function newExpiry(): string {
  return new Date(Date.now() + THIRTY_DAYS_MS).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}
function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt.replace(' ', 'T') + 'Z').getTime() < Date.now();
}

// Short, URL-safe, not sequential/guessable — 10 hex chars is plenty for
// this volume (not a security boundary, just avoids someone stumbling onto
// another designer's link by trying nearby tokens).
function newToken(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------- Authenticated management (mounted under /api) ----------
const redirectLinks = new Hono<{ Bindings: Bindings }>();

redirectLinks.put('/projects/:id/redirect-link', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const projectId = c.req.param('id');
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{ destinationUrl?: string }>().catch(() => ({}) as { destinationUrl?: string });
  const destinationUrl = (body.destinationUrl || '').trim();
  if (!destinationUrl || !isHttpUrl(destinationUrl)) return c.json({ error: 'invalid_url', message: 'Enter a valid http(s) URL.' }, 400);

  const existing = await c.env.DB.prepare('SELECT token, expires_at FROM redirect_links WHERE project_id = ?').bind(projectId).first<{ token: string; expires_at: string }>();
  if (existing) {
    // Only the destination changes here — expiry is untouched, renewed
    // separately, so editing the URL doesn't quietly reset a running clock.
    await c.env.DB.prepare("UPDATE redirect_links SET destination_url = ?, updated_at = datetime('now') WHERE project_id = ?").bind(destinationUrl, projectId).run();
    return c.json({ token: existing.token, destinationUrl, expiresAt: existing.expires_at });
  }
  const token = newToken();
  const expiresAt = newExpiry();
  await c.env.DB.prepare('INSERT INTO redirect_links (project_id, token, destination_url, expires_at) VALUES (?, ?, ?, ?)')
    .bind(projectId, token, destinationUrl, expiresAt)
    .run();
  return c.json({ token, destinationUrl, expiresAt });
});

redirectLinks.get('/projects/:id/redirect-link', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const projectId = c.req.param('id');
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  const link = await c.env.DB.prepare('SELECT token, destination_url, created_at, expires_at, visible_to_customer FROM redirect_links WHERE project_id = ?')
    .bind(projectId)
    .first<{ token: string; destination_url: string; created_at: string; expires_at: string; visible_to_customer: number }>();
  if (!link) return c.json({ link: null });

  const totalRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM redirect_clicks WHERE token = ?').bind(link.token).first<{ count: number }>();
  const { results: topCountries } = await c.env.DB.prepare(
    `SELECT country, COUNT(*) as count FROM redirect_clicks WHERE token = ? AND country IS NOT NULL GROUP BY country ORDER BY count DESC LIMIT 3`
  )
    .bind(link.token)
    .all<{ country: string; count: number }>();

  return c.json({
    link: {
      token: link.token,
      destinationUrl: link.destination_url,
      createdAt: link.created_at,
      expiresAt: link.expires_at,
      expired: isExpired(link.expires_at),
      totalClicks: totalRow?.count ?? 0,
      topCountries,
      visibleToCustomer: !!link.visible_to_customer,
    },
  });
});

// Separate from the URL/expiry PUT above so toggling it doesn't require
// resubmitting the destination URL too.
redirectLinks.put('/projects/:id/redirect-link/visibility', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const projectId = c.req.param('id');
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{ visible?: boolean }>().catch(() => ({}) as { visible?: boolean });
  const result = await c.env.DB.prepare("UPDATE redirect_links SET visible_to_customer = ?, updated_at = datetime('now') WHERE project_id = ?")
    .bind(body.visible ? 1 : 0, projectId)
    .run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ visibleToCustomer: !!body.visible });
});

redirectLinks.post('/projects/:id/redirect-link/renew', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const projectId = c.req.param('id');
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  const expiresAt = newExpiry();
  const result = await c.env.DB.prepare("UPDATE redirect_links SET expires_at = ?, updated_at = datetime('now') WHERE project_id = ?").bind(expiresAt, projectId).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ expiresAt });
});

redirectLinks.delete('/projects/:id/redirect-link', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const projectId = c.req.param('id');
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  await c.env.DB.prepare('DELETE FROM redirect_links WHERE project_id = ?').bind(projectId).run();
  return c.json({ ok: true });
});

export default redirectLinks;

// ---------- Public click + redirect (mounted at root, NOT under /api — see
// stagepay-web/functions/r/[token].ts, which proxies the short /r/:token URL
// straight through to this same path on the Worker) ----------
export const redirectPublic = new Hono<{ Bindings: Bindings }>();

function brandedPageHtml(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — StagePay</title>
  <style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#14161b;color:#eef1f2;font-family:-apple-system,"Segoe UI",sans-serif;text-align:center;padding:24px}
  .card{max-width:380px}.mark{font-size:32px}h1{font-size:20px;margin:12px 0 8px}p{color:#8b92a1;font-size:14px;line-height:1.6}</style></head>
  <body><div class="card"><div class="mark">💸</div>${body}</div></body></html>`;
}

redirectPublic.get('/r/:token', async (c) => {
  const token = c.req.param('token');
  const link = await c.env.DB.prepare('SELECT destination_url, expires_at FROM redirect_links WHERE token = ?')
    .bind(token)
    .first<{ destination_url: string; expires_at: string }>();
  if (!link) return c.html(brandedPageHtml('Link not found', '<h1>Link not found</h1><p>This link doesn\'t exist or has been removed.</p>'), 404);

  if (isExpired(link.expires_at)) {
    const totalRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM redirect_clicks WHERE token = ?').bind(token).first<{ count: number }>();
    const count = totalRow?.count ?? 0;
    return c.html(
      brandedPageHtml('Link expired', `<h1>This link has expired</h1><p>It received ${count} click${count === 1 ? '' : 's'} while it was active.</p>`),
      410
    );
  }

  // Fire-and-forget — the click gets logged, but nobody waits on the DB
  // write before being redirected through.
  const country = (c.req.raw as { cf?: { country?: string } }).cf?.country || null;
  const referrer = c.req.header('Referer') || null;
  c.executionCtx.waitUntil(
    c.env.DB.prepare('INSERT INTO redirect_clicks (id, token, referrer, country) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), token, referrer, country).run()
  );

  return c.redirect(link.destination_url, 302);
});
