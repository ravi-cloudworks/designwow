// Proxies everything under /api/* to the design-wow-api Worker, so the
// browser only ever talks to designwow.pages.dev. This makes the session
// cookie first-party — without it, Chrome Incognito (and Safari everywhere)
// silently drops the cookie as a third-party cookie no matter what SameSite
// value it's given, since pages.dev and workers.dev are different sites.
const API_ORIGIN = 'https://design-wow-api.ravi-cloudworks.workers.dev';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const upstreamUrl = API_ORIGIN + url.pathname + url.search;
  const upstreamRequest = new Request(upstreamUrl, context.request);
  return fetch(upstreamRequest);
};
