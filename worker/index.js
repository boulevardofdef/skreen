// Skreen weather proxy (Cloudflare Worker, free tier).
// MET Norway requires every request to identify the app and a contact address,
// and asks clients to cache. Browsers can't set User-Agent, so this does both.
const CONTACT = 'Skreen/1.0 (+https://github.com/boulevardofdef/skreen; tiszenkel@gmail.com)';
const ALLOWED_PATH = '/weatherapi/locationforecast/2.0/complete';
const CACHE_SECONDS = 900;

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' };

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname !== ALLOWED_PATH) return new Response('Not found', { status: 404, headers: cors });
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return new Response('Bad coordinates', { status: 400, headers: cors });

    // Round to ~100 m so nearby tablets share one cached answer.
    const key = new Request(`https://cache.skreen/${lat.toFixed(2)},${lon.toFixed(2)}`);
    const cache = caches.default;
    let res = await cache.match(key);
    if (!res) {
      const upstream = await fetch(`https://api.met.no${ALLOWED_PATH}?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`, { headers: { 'User-Agent': CONTACT } });
      if (!upstream.ok) return new Response('Upstream error', { status: 502, headers: cors });
      res = new Response(upstream.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
