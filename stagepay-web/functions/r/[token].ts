// Proxies the short public click-through URL (/r/:token) straight to the
// Worker's own /r/:token route — same first-party-origin reasoning as
// functions/api/[[path]].ts, plus redirect:'manual' so the Worker's 302
// passes through untouched instead of this function following it itself
// (which would show the client's site under the stagepay.pages.dev address
// bar instead of a real redirect).
const API_ORIGIN = 'https://stagepay-api.ravi-cloudworks.workers.dev';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const upstreamUrl = API_ORIGIN + url.pathname + url.search;
  const upstreamRequest = new Request(upstreamUrl, context.request);
  return fetch(upstreamRequest, { redirect: 'manual' });
};
