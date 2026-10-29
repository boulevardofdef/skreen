// Skreen relay, all in one file (built from index.js + news.js) for pasting into the Cloudflare dashboard.
// Headlines for the "In the news" widget and tour slide.
//
// Every 30 minutes (cron) this reads Wikipedia's Current events pages for today and yesterday (UTC),
// asks a Claude model to choose and write short AP-style headlines from them, and keeps the result in
// one KV entry. The model also sees the headlines it wrote last time, so a story stays while its facts
// are unchanged and it still outranks newer ones, and goes when it leaves the page.
// Wikipedia text is CC BY-SA; the app carries the credit.

const MODEL = 'claude-sonnet-5-5';
const KEEP = 8;            // the app shows the top 2 to 4
const LIFE_H = 4;          // an ordinary headline stays up this long, then makes way for others
const MAJOR_LIFE_H = 24;  // a true front-page story can stay up to a day (until a follow-up headline replaces it)
const RETIRED_H = 48;     // how long we remember retired headlines, so the same facts aren't put back up
const lifeMs = (h) => (h && h.major ? MAJOR_LIFE_H : LIFE_H) * 36e5;
const alive = (h, now) => now - Date.parse(h.at) <= lifeMs(h);
const KEY = 'headlines';

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Wikitext line → plain text. Links keep their label, external links keep only the outlet's name.
function plain(w) {
  return w
    .replace(/<ref[^>]*\/>|<ref[^>]*>.*?<\/ref>|<!--.*?-->/gs, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[https?:\/\/\S+\s+\(([^)]*)\)\]/g, '')       // [url (AP)]: sources are dropped, so are the links
    .replace(/\[https?:\/\/[^\s\]]+(?:\s+[^\]]*)?\]/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (entities[e.toLowerCase()] ?? m)))
    .replace(/\s+/g, ' ').trim();
}

// A Current events page → [{ n, cat, context, text }] with one entry per actual news item.
// Bullets nest: a shorter bullet is the topic ("2026 Toledo train collision"), the deepest ones are the items.
function parsePage(raw, day) {
  const out = [];
  let cat = '', ctx = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const head = line.match(/^'''(.+?)'''\s*$/);
    if (head) { cat = plain(head[1]); ctx = []; continue; }
    const m = line.match(/^(\*+)\s*(.*)$/);
    if (!m) continue;
    const depth = m[1].length, text = plain(m[2]);
    if (!text) continue;
    ctx.length = depth - 1; ctx[depth - 1] = text;
    const next = lines[i + 1] && lines[i + 1].match(/^(\*+)/);
    const isLeaf = !next || next[1].length <= depth;
    if (isLeaf) out.push({ day, cat, topic: ctx.slice(0, depth - 1).filter(Boolean).join(' / '), text });
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pageName = (d) => `Portal:Current_events/${d.getUTCFullYear()}_${MONTHS[d.getUTCMonth()]}_${d.getUTCDate()}`;

async function fetchDay(d, contact) {
  const res = await fetch(`https://en.wikipedia.org/w/index.php?title=${pageName(d)}&action=raw`, { headers: { 'User-Agent': contact } });
  if (!res.ok) throw new Error(`Wikipedia ${res.status} for ${pageName(d)}`);
  return parsePage(await res.text(), `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
}

const SYSTEM = `You are the news editor for a wall display in people's homes. From a list of items taken from Wikipedia's Current events page, choose the stories of most significance and broadest interest to a mainstream international audience, and write a headline for each.

Headline rules:
- AP style: present tense for events that just happened, single quotes inside headlines, AP abbreviations and capitalization (write US, not U.S., in headlines), numerals for 10 and up, no period at the end.
- Brief, neutral and punchy: 75 characters or fewer, and never more than 85. Use short words. Cut to the single main fact.
- One idea per headline. Never join two clauses with a semicolon or a dash. If a story has two developments, write about the bigger one.
- Facts only. Use nothing that isn't in the item. No adjectives that editorialize, no speculation, no questions.
- A reader with no context must understand it: name the place or the person's role, not just a surname.
- Merge items about the same event into one headline.

What to choose:
- Use your judgment: choose the stories that are most significant and have the most impact on people's lives, for a mainstream international audience.
- Consider the list as a whole. A varied mix of topics and regions reads better on a wall than several stories of the same kind. Don't fill the list with one theme.
- Business and economic news counts only when it affects many countries or many people's lives (a major central bank such as the Federal Reserve, ECB or Bank of England, or a market-wide shock). A smaller country's rate change, a single company's deal or a routine economic release is low priority and usually left out.
- Skip routine, local and niche items. Sports, culture and science count when the event is exceptional.

Rolling list and freshness:
- You also get the headlines you chose last time, each with its age and the source items it was built from.
- Headlines rotate. An ordinary headline stays up about ${LIFE_H} hours, then is retired, even if its story is still on the page, so that other stories get a turn. Retired headlines are listed for you: do not write them again unless the item has new facts.
- A true front-page story may stay up to ${MAJOR_LIFE_H} hours. Mark it "major": true. Reserve this for stories every newsroom would lead with: a catastrophe with a large death toll, a war's major turning point, a national leader elected, deposed or killed. At most two at a time. Most headlines are not major.
- When a story develops, write a new headline about the new facts (it replaces the old one). Do not keep a headline whose facts have been overtaken.
- Keep a previous headline, text unchanged, only while its facts are unchanged, it is still in the current items, and it is still among the most significant choices.
- If a previous headline's story is no longer in the current items, drop it.
- Rank the list by your judgment of significance, most significant first. Return at most ${KEEP}.

Reply with JSON only, no other text:
{"headlines":[{"text":"...","lines":[3,7],"prev":null,"major":false}]}
"lines" are the numbers of the current items the headline is built from. "prev" is the id of the previous headline you are keeping unchanged, or null.`;

function buildPrompt(items, prev, now, retired = []) {
  const cur = items.map((it, i) => `${i + 1}. [${it.day}] ${it.cat}${it.topic ? ' / ' + it.topic : ''}: ${it.text}`).join('\n');
  const old = prev.length
    ? prev.map((p, i) => `id ${i + 1} (${(Math.round((now - Date.parse(p.at)) / 36e4) / 10)}h old${p.major ? ', major' : ''}): ${p.text}\n   from: ${p.src.join(' | ')}`).join('\n')
    : '(none yet)';
  const gone = retired.length ? retired.map((r) => `- ${r.text}`).join('\n') : '(none)';
  return `Current items:\n${cur}\n\nPrevious headlines:\n${old}\n\nRetired headlines (do not repeat):\n${gone}`;
}

// The model's reply → a clean list, or null when it can't be trusted.
function checkReply(reply, items, prev, now, retired = []) {
  let data;
  try { data = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch (_) { return null; }
  if (!data || !Array.isArray(data.headlines)) return null;
  const out = [];
  for (const h of data.headlines) {
    const text = String((h && h.text) || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
    const lines = Array.isArray(h && h.lines) ? h.lines.filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length) : [];
    if (text.length < 15 || text.length > 90 || /https?:|www\./i.test(text) || !lines.length) continue;
    const before = Number.isInteger(h.prev) && prev[h.prev - 1] && prev[h.prev - 1].text === text ? prev[h.prev - 1] : null;
    const at = before ? before.at : new Date(now).toISOString();
    const src = lines.map((n) => items[n - 1].text);
    const major = !!h.major && out.filter((o) => o.major).length < 2;
    if (!alive({ at, major }, now)) continue;
    if (out.some((o) => o.text === text)) continue;
    if (retired.some((r) => src.every((t) => r.src.includes(t)))) continue;   // same facts as a retired headline: not news again
    out.push({ text, at, src, major });
    if (out.length === KEEP) break;
  }
  return out.length >= 2 ? out : null;   // the app shows two at the least
}

async function ask(env, system, user) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const body = await res.json();
  return (body.content || []).map((b) => b.text || '').join('');
}

// Run by the cron trigger. Any failure leaves the last good list in place.
async function refreshNews(env, contact, now = Date.now()) {
  if (!env.NEWS || !env.ANTHROPIC_API_KEY) return 'not configured';
  const days = [new Date(now - 864e5), new Date(now)];
  const items = (await Promise.all(days.map((d) => fetchDay(d, contact)))).flat();
  if (items.length < 5) return 'too few items';
  const stored = await env.NEWS.get(KEY, 'json');
  const onPage = (p) => p.src && p.src.every((s) => items.some((it) => it.text === s));
  const prev = ((stored && stored.stories) || []).filter((p) => alive(p, now) && onPage(p));   // a story whose source lines are gone, or whose time is up, is gone
  const retired = [
    ...((stored && stored.retired) || []),
    ...((stored && stored.stories) || []).filter((p) => !alive(p, now)),
  ].filter((r) => now - Date.parse(r.at) <= RETIRED_H * 36e5).filter((r, i, all) => all.findIndex((x) => x.text === r.text) === i);
  const signature = JSON.stringify(items.map((i) => i.text));   // same page as last time and nothing expired or gone: no need to ask again
  if (stored && stored.signature === signature && prev.length === stored.stories.length) return 'unchanged';
  const list = checkReply(await ask(env, SYSTEM, buildPrompt(items, prev, now, retired)), items, prev, now, retired);
  if (!list) return 'rejected reply';
  await env.NEWS.put(KEY, JSON.stringify({ stories: list, retired, signature, updated: new Date(now).toISOString() }));
  return `wrote ${list.length}`;
}

async function storedHeadlines(env) {
  if (!env.NEWS) return null;
  const s = await env.NEWS.get(KEY, 'json');
  const fresh = ((s && s.stories) || []).filter((x) => alive(x, Date.now()));   // if refreshing stalls, old headlines age out and the Wikipedia box takes over
  return fresh.length ? fresh.map((x) => ({ text: x.text, url: '' })) : null;
}
// Skreen relay (Cloudflare Worker, free tier).
//   /weatherapi/locationforecast/2.0/complete  → MET Norway forecast
//   /geocode?q=…                               → city / ZIP search (OpenStreetMap Nominatim)
//   /reverse?lat=…&lon=…                       → coordinates to a place name
//   /ics?u=<https calendar link>               → fetches a published calendar (ICS) for the browser
//   /news                                      → headlines written from Wikipedia's Current events (see news.js); the "In the news" box is the fallback
//   /radio?q=…                                 → internet radio stations (radio-browser.info) to search and play
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
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshNews(env, CONTACT).then((r) => console.log('news:', r), (e) => console.log('news failed:', e.message)));
  },

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
      const written = await storedHeadlines(env).catch(() => null);
      if (written) return json({ stories: written }, 200, { 'Cache-Control': 'public, max-age=600' });
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

    if (url.pathname === '/radio') {
      // Internet radio stations from the community directory radio-browser.info: search by name, or the
      // most-listened stations when there is no search. Only https streams (the app can't play plain http).
      const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
      const api = 'https://de1.api.radio-browser.info/json/stations/' + (q
        ? `search?name=${encodeURIComponent(q)}&limit=60&hidebroken=true&order=clickcount&reverse=true`
        : 'topclick/60');
      const res = await cached(ctx, `r/${q.toLowerCase()}`, 3600, () => fetch(api, { headers: { 'User-Agent': CONTACT, Accept: 'application/json' } }));
      if (!res) return json({ error: 'upstream' }, 502);
      const items = ((await res.json()) || []).filter((s) => /^https:\/\//.test(s.url_resolved || '')).map((s) => ({
        name: String(s.name || '').trim().slice(0, 80), url: s.url_resolved, where: [s.state, s.country].filter(Boolean).join(', '), tags: String(s.tags || '').split(',').slice(0, 3).join(', '),
      })).filter((s) => s.name).slice(0, 25);
      return json({ items }, 200, { 'Cache-Control': 'public, max-age=600' });
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
