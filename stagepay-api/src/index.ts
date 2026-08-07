import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './lib/bindings';
import { currentUserId } from './lib/bindings';
import auth from './routes/auth';
import projects from './routes/projects';
import items from './routes/items';
import suggest from './routes/suggest';
import media from './routes/media';
import config from './routes/config';
import pay from './routes/pay';
import showcase from './routes/showcase';
import earnings from './routes/earnings';
import credits from './routes/credits';
import director from './routes/director';
import admin from './routes/admin';
import redirectLinks, { redirectPublic } from './routes/redirect';

const app = new Hono<{ Bindings: Bindings }>();

// Independent of design-wow-api's CORS allow-list — StagePay is its own
// deployment, own domain, own Pages project.
function isAllowedOrigin(origin: string): boolean {
  return (
    origin === 'http://localhost:5173' ||
    origin === 'http://localhost:8788' ||
    origin === 'https://stagepay.pages.dev' ||
    /^https:\/\/[a-z0-9-]+\.stagepay\.pages\.dev$/.test(origin)
  );
}

app.use('*', async (c, next) => {
  const middleware = cors({
    origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : c.env.FRONTEND_ORIGIN),
    credentials: true,
  });
  return middleware(c, next);
});

app.get('/api/health', (c) => c.json({ ok: true, service: 'stagepay-api' }));

// Misuse kill switch — blocks a suspended user's own dashboard/API access
// immediately, everywhere, rather than touching every individual route file
// (11 of them each independently resolve currentUserId today). GET /me and
// /logout stay reachable so the frontend can show a clear "your account has
// been suspended" screen (via the suspended field GET /me now returns) and
// let them sign out, rather than a generic, confusing 403 on the very first
// boot call. This only ever fires for a session that actually belongs to a
// suspended user — an anonymous visitor to a public showcase/pay-link page
// has no session at all, so this never affects them; that page pausing for
// a suspended DESIGNER is a separate check, made against the project
// owner's own row (see showcase.ts / pay.ts), not this middleware.
const SUSPENSION_CHECK_ALLOWLIST = new Set(['/api/health', '/api/auth/google', '/api/auth/google/callback', '/api/auth/me', '/api/auth/logout']);
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (!SUSPENSION_CHECK_ALLOWLIST.has(path)) {
    const userId = await currentUserId(c);
    if (userId) {
      const row = await c.env.DB.prepare('SELECT suspended FROM users WHERE id = ?').bind(userId).first<{ suspended: number }>();
      if (row?.suspended) return c.json({ error: 'suspended', message: 'Your account has been suspended. Contact support.' }, 403);
    }
  }
  await next();
});

app.route('/api/auth', auth);
app.route('/api/projects', projects);
app.route('/api', items);
app.route('/api', suggest);
app.route('/api', media);
app.route('/api', config);
app.route('/api', pay);
app.route('/api', showcase);
app.route('/api', earnings);
app.route('/api', credits);
app.route('/api', director);
app.route('/api', admin);
app.route('/api', redirectLinks);
// Unprefixed — this is the short public click-through URL itself
// (stagepay.pages.dev/r/:token), not an /api/* call the frontend fetches.
app.route('/', redirectPublic);

export default app;
