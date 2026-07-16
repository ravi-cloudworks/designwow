// Proxies everything under /api/* to the stagepay-api Worker, so the browser
// only ever talks to stagepay.pages.dev. This makes the session cookie
// first-party — without it, Chrome Incognito (and Safari everywhere) silently
// drops the cookie as third-party no matter what SameSite value it's given,
// since pages.dev and workers.dev are different sites. Mirrors the exact
// same pattern design-wow-pages uses for design-wow-api.
const API_ORIGIN = 'https://stagepay-api.ravi-cloudworks.workers.dev';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const upstreamUrl = API_ORIGIN + url.pathname + url.search;
  const upstreamRequest = new Request(upstreamUrl, context.request);
  return fetch(upstreamRequest);
};
