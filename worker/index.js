// Skreen relay (Cloudflare Worker, free tier).
//   /weatherapi/locationforecast/2.0/complete  → MET Norway forecast
//   /geocode?q=…                               → city / ZIP search (OpenStreetMap Nominatim)
//   /reverse?lat=…&lon=…                       → coordinates to a place name
//   /ics?u=<https calendar link>               → fetches a published calendar (ICS) for the browser
//   /news                                      → today's "In the news" stories from Wikipedia (CC BY-SA)
//   /art                                       → public-domain paintings (Wikimedia Commons) for the photo slideshow
// The services we call want every request to identify the app and a contact address, and ask
// clients to cache. Browsers can't set User-Agent, so this does both, and stores nothing else.
const CONTACT = 'Skreen/1.0 (+https://github.com/boulevardofdef/skreen; tiszenkel@gmail.com)';
const FORECAST_PATH = '/weatherapi/locationforecast/2.0/complete';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors, ...extra } });

// Fetch an upstream URL through the edge cache for `ttl` seconds.
async function cached(ctx, cacheKey, ttl, fetchUpstream) {
  const cache = caches.default;
  const key = new Request('https://cache.skreen/' + cacheKey);
  let res = await cache.match(key);
  if (!res) {
    const up = await fetchUpstream();
    if (!up.ok) return null;
    res = new Response(up.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } });
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return res;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const place = (r) => {
  const a = r.address || {};
  return {
    name: a.city || a.town || a.village || a.hamlet || a.suburb || a.municipality || a.county || r.name || '',
    region: a.state || a.region || '',
    country: (a.country_code || '').toUpperCase(),
  };
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);

    if (url.pathname === FORECAST_PATH) {
      const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
      if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'bad coordinates' }, 400);
      // Round to ~1 km so nearby tablets share one cached answer.
      const res = await cached(ctx, `f/${lat.toFixed(2)},${lon.toFixed(2)}`, 900, () =>
        fetch(`https://api.met.no${FORECAST_PATH}?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`, { headers: { 'User-Agent': CONTACT } }));
      if (!res) return json({ error: 'upstream' }, 502);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    }

    if (url.pathname === '/geocode') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      if (q.length < 2) return json({ results: [] });
      const res = await cached(ctx, 'g/' + q.toLowerCase(), 86400, () =>
        fetch(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=8&accept-language=en&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': CONTACT } }));
      if (!res) return json({ error: 'upstream' }, 502);
      const seen = new Set(), results = [];
      for (const r of await res.json()) {
        const p = place(r), lat = +r.lat, lon = +r.lon;
        if (!p.name || !isFinite(lat) || !isFinite(lon)) continue;
        const key = `${p.name}|${p.region}|${p.country}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ ...p, lat: +lat.toFixed(3), lon: +lon.toFixed(3) });
        if (results.length === 6) break;
      }
      return json({ results }, 200, { 'Cache-Control': 'public, max-age=3600' });
    }

    if (url.pathname === '/reverse') {
      const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
      if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'bad coordinates' }, 400);
      const res = await cached(ctx, `r/${lat.toFixed(2)},${lon.toFixed(2)}`, 604800, () =>
        fetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=10&accept-language=en&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`, { headers: { 'User-Agent': CONTACT } }));
      if (!res) return json({ error: 'upstream' }, 502);
      return json(place(await res.json()), 200, { 'Cache-Control': 'public, max-age=86400' });
    }

    if (url.pathname === '/news') {
      // Wikipedia's featured feed carries the "In the news" box: a few current stories, each with links.
      const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return entities[e.toLowerCase()] ?? m;
      }).replace(/\s*\(pictured\)/gi, '').replace(/\s+/g, ' ').trim();
      for (let back = 0; back < 2; back++) {
        const d = new Date(Date.now() - back * 86400000);
        const day = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
        const res = await cached(ctx, 'n/' + day, 1800, () =>
          fetch(`https://en.wikipedia.org/api/rest_v1/feed/featured/${day}`, { headers: { 'User-Agent': CONTACT, Accept: 'application/json' } }));
        if (!res) continue;
        const stories = ((await res.json()).news || []).map((n) => {
          const link = (n.links || []).find((l) => l.content_urls && l.content_urls.desktop) || (n.links || [])[0];
          const page = link && ((link.content_urls && link.content_urls.desktop && link.content_urls.desktop.page) || `https://en.wikipedia.org/wiki/${encodeURIComponent(link.title)}`);
          return { text: plain(n.story || ''), url: page || '' };
        }).filter((s) => s.text).slice(0, 8);
        if (stories.length) return json({ stories }, 200, { 'Cache-Control': 'public, max-age=900' });
      }
      return json({ error: 'upstream' }, 502);
    }

    if (url.pathname === '/art') {
      // Public-domain paintings from the Art Institute of Chicago's open API (CC0). Which hundred we offer
      // changes daily; each picture is served by their image service at a size that suits a wall display.
      // Paintings from Wikimedia Commons: public domain, and the pictures load straight into the app
      // (the Art Institute's image server sits behind a bot check that blocks a tablet's browser view).
      const commons = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|size&iiextmetadatafilter=Artist|ObjectName&iiurlwidth=1600';
      const dayN = Math.floor(Date.now() / 86400000);
      const find = (term) => `&generator=search&gsrnamespace=6&gsrlimit=100&gsrsearch=${encodeURIComponent(term)}`;
      const members = (cat) => `&generator=categorymembers&gcmtitle=Category:${cat}&gcmtype=file&gcmlimit=100`;
      const attempts = [
        members('Featured_pictures_of_paintings'),
        find('incategory:"Featured pictures on Wikimedia Commons" painting filetype:bitmap'),
        find('"Google Art Project" painting filetype:bitmap'),
        members('Quality_images_of_paintings'),
      ];
      const plain = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      const notes = [];
      for (const [n, part] of attempts.entries()) {
        let pages = [];
        try {
          const res = await cached(ctx, `c2/${dayN}/${n}`, 86400, () => fetch(commons + part, { headers: { 'User-Agent': CONTACT, Accept: 'application/json' } }));
          if (!res) { notes.push(`${n}: upstream refused`); continue; }
          pages = Object.values(((await res.json()).query || {}).pages || {});
        } catch (e) { notes.push(`${n}: ${e.message}`); continue; }
        const items = pages.map((p) => ({ p, i: (p.imageinfo || [])[0] })).filter(({ p, i }) => i && i.thumburl && /\.(jpe?g|png)$/i.test(p.title || '') && i.width >= 1000 && i.width * i.height < 120e6)
          .map(({ p, i }) => ({
            title: plain((i.extmetadata && i.extmetadata.ObjectName && i.extmetadata.ObjectName.value) || String(p.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ')),
            artist: plain(i.extmetadata && i.extmetadata.Artist && i.extmetadata.Artist.value),
            image: i.thumburl,
          })).filter((a) => a.title.length < 120);
        const withInfo = pages.filter((p) => p.imageinfo && p.imageinfo[0]).length;
        notes.push(`${n}: ${pages.length} files, ${withInfo} with info, ${items.length} usable${items.length ? '' : ' - first: ' + JSON.stringify(pages[0] || {}).slice(0, 500)}`);
        if (items.length >= 5) {
          for (let k = items.length - 1; k > 0; k--) { const j2 = (k * 7 + dayN) % (k + 1); [items[k], items[j2]] = [items[j2], items[k]]; }
          return json({ items: items.slice(0, 80) }, 200, { 'Cache-Control': 'public, max-age=3600' });
        }
      }
      return json({ error: 'upstream', notes }, 502);
    }

    if (url.pathname === '/ics') {
      let target;
      try { target = new URL(url.searchParams.get('u') || ''); } catch (_) { return json({ error: 'bad link' }, 400); }
      if (target.protocol === 'webcal:') target = new URL('https:' + target.href.slice(7));
      const host = target.hostname;
      // Public https hosts only: no addresses, no local names, no odd ports.
      if (target.protocol !== 'https:' || (target.port && target.port !== '443') || /^[\d.:\[\]]+$/.test(host) || !host.includes('.') || /(^|\.)(local|internal|localhost)$/.test(host)) {
        return json({ error: 'bad link' }, 400);
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(target.href));
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const cache = caches.default, key = new Request('https://cache.skreen/i/' + hash);   // keyed by a hash: the link itself is never stored
      let res = await cache.match(key);
      if (!res) {
        const up = await fetch(target.href, { headers: { 'User-Agent': CONTACT, Accept: 'text/calendar, text/plain, */*' }, redirect: 'follow' });
        if (!up.ok) return json({ error: 'upstream ' + up.status }, 502);
        const text = await up.text();
        if (text.length > 3000000) return json({ error: 'too large' }, 413);
        if (!/^\s*BEGIN:VCALENDAR/i.test(text)) return json({ error: 'not a calendar' }, 422);
        res = new Response(text, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
        ctx.waitUntil(cache.put(key, res.clone()));
      }
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    }

    return json({ error: 'not found' }, 404);
  },
};
