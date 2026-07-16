import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './lib/bindings';
import auth from './routes/auth';
import projects from './routes/projects';
import items from './routes/items';
import suggest from './routes/suggest';
import media from './routes/media';
import config from './routes/config';
import pay from './routes/pay';
import showcase from './routes/showcase';
import earnings from './routes/earnings';

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

app.route('/api/auth', auth);
app.route('/api/projects', projects);
app.route('/api', items);
app.route('/api', suggest);
app.route('/api', media);
app.route('/api', config);
app.route('/api', pay);
app.route('/api', showcase);
app.route('/api', earnings);

export default app;
