import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './lib/bindings';
import auth from './routes/auth';
import requests from './routes/requests';
import designers from './routes/designers';
import assets from './routes/assets';
import subscriptions from './routes/subscriptions';
import users from './routes/users';
import waitlist from './routes/waitlist';

const app = new Hono<{ Bindings: Bindings }>();

// Allows the production Pages domain, its preview-deployment subdomains
// (random-hash.designwow.pages.dev), and local dev.
function isAllowedOrigin(origin: string): boolean {
  return (
    origin === 'http://localhost:5173' ||
    origin === 'https://designwow.pages.dev' ||
    /^https:\/\/[a-z0-9-]+\.designwow\.pages\.dev$/.test(origin)
  );
}

app.use('*', async (c, next) => {
  const middleware = cors({
    origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : c.env.FRONTEND_ORIGIN),
    credentials: true,
  });
  return middleware(c, next);
});

app.get('/api/health', (c) => c.json({ ok: true, service: 'design-wow-api' }));

app.route('/api/auth', auth);
app.route('/api/requests', requests);
app.route('/api/designers', designers);
app.route('/api/assets', assets);
app.route('/api/subscriptions', subscriptions);
app.route('/api/users', users);
app.route('/api/waitlist', waitlist);

export default app;
