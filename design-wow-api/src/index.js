import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import requests from './routes/requests';
import designers from './routes/designers';
import assets from './routes/assets';
import subscriptions from './routes/subscriptions';
const app = new Hono();
// Allows the production Pages domain, its preview-deployment subdomains
// (random-hash.design-wow-pages.pages.dev), and local dev.
function isAllowedOrigin(origin) {
    return (origin === 'http://localhost:5173' ||
        origin === 'https://design-wow-pages.pages.dev' ||
        /^https:\/\/[a-z0-9-]+\.design-wow-pages\.pages\.dev$/.test(origin));
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
export default app;
