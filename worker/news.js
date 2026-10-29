// Headlines for the "In the news" widget and tour slide.
//
// Every 30 minutes (cron) this reads Wikipedia's Current events pages for today and yesterday (UTC),
// asks a Claude model to choose and write short AP-style headlines from them, and keeps the result in
// one KV entry. The model also sees the headlines it wrote last time, so a story stays while its facts
// are unchanged and it still outranks newer ones, and goes when it leaves the page.
// Wikipedia text is CC BY-SA; the app carries the credit.

const MODEL = 'claude-sonnet-5-5';
const KEEP = 8;            // the app shows the top 2 to 4
const MAX_AGE_H = 36;      // a headline never outlives this, whatever its rank
const KEY = 'headlines';

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Wikitext line → plain text. Links keep their label, external links keep only the outlet's name.
export function plain(w) {
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
export function parsePage(raw, day) {
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

export const SYSTEM = `You are the news editor for a wall display in people's homes. From a list of items taken from Wikipedia's Current events page, choose the stories of most significance and broadest interest to a mainstream international audience, and write a headline for each.

Headline rules:
- AP style: present tense for events that just happened, single quotes inside headlines, AP abbreviations and capitalization, numerals for 10 and up, no period at the end.
- Brief, neutral and punchy. 70 characters or fewer when possible, 100 at most.
- Facts only. Use nothing that isn't in the item. No adjectives that editorialize, no speculation, no questions.
- A reader with no context must understand it: name the place or the person's role, not just a surname.
- Prefer stories that change people's lives, matter to many countries, or are big breaking events. Skip routine sports results, local crime and niche items unless the event is exceptional.
- One story per headline. Merge items about the same event.

Rolling list:
- You also get the headlines you chose last time, each with its age and the source items it was built from.
- Keep a previous headline, with its text unchanged, only when its facts are unchanged, it is still in the current items, and it is more significant than the new candidates it would displace, while still reasonably fresh (under about 24 hours unless it is clearly still the biggest story).
- If the facts of a story have changed, write a new headline for it.
- If a previous headline's story is no longer in the current items, drop it.
- Rank the list: most significant first. Return at most ${KEEP}.

Reply with JSON only, no other text:
{"headlines":[{"text":"...","lines":[3,7],"prev":null}]}
"lines" are the numbers of the current items the headline is built from. "prev" is the id of the previous headline you are keeping unchanged, or null.`;

export function buildPrompt(items, prev, now) {
  const cur = items.map((it, i) => `${i + 1}. [${it.day}] ${it.cat}${it.topic ? ' / ' + it.topic : ''}: ${it.text}`).join('\n');
  const old = prev.length
    ? prev.map((p, i) => `id ${i + 1} (${Math.round((now - Date.parse(p.at)) / 36e5)}h old): ${p.text}\n   from: ${p.src.join(' | ')}`).join('\n')
    : '(none yet)';
  return `Current items:\n${cur}\n\nPrevious headlines:\n${old}`;
}

// The model's reply → a clean list, or null when it can't be trusted.
export function checkReply(reply, items, prev, now) {
  let data;
  try { data = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch (_) { return null; }
  if (!data || !Array.isArray(data.headlines)) return null;
  const out = [];
  for (const h of data.headlines) {
    const text = String((h && h.text) || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
    const lines = Array.isArray(h && h.lines) ? h.lines.filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length) : [];
    if (text.length < 15 || text.length > 110 || /https?:|www\./i.test(text) || !lines.length) continue;
    const before = Number.isInteger(h.prev) && prev[h.prev - 1] && prev[h.prev - 1].text === text ? prev[h.prev - 1] : null;
    const at = before ? before.at : new Date(now).toISOString();
    if (now - Date.parse(at) > MAX_AGE_H * 36e5) continue;
    if (out.some((o) => o.text === text)) continue;
    out.push({ text, at, src: lines.map((n) => items[n - 1].text) });
    if (out.length === KEEP) break;
  }
  return out.length >= 3 ? out : null;
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
export async function refreshNews(env, contact, now = Date.now()) {
  if (!env.NEWS || !env.ANTHROPIC_API_KEY) return 'not configured';
  const days = [new Date(now - 864e5), new Date(now)];
  const items = (await Promise.all(days.map((d) => fetchDay(d, contact)))).flat();
  if (items.length < 5) return 'too few items';
  const stored = await env.NEWS.get(KEY, 'json');
  const prev = ((stored && stored.stories) || []).filter((p) => now - Date.parse(p.at) <= MAX_AGE_H * 36e5 && p.src && p.src.every((s) => items.some((it) => it.text === s)));   // a story whose source lines are gone, or that is too old, is gone
  const signature = JSON.stringify(items.map((i) => i.text));   // same page as last time and nothing expired or gone: no need to ask again
  if (stored && stored.signature === signature && prev.length === stored.stories.length) return 'unchanged';
  const list = checkReply(await ask(env, SYSTEM, buildPrompt(items, prev, now)), items, prev, now);
  if (!list) return 'rejected reply';
  await env.NEWS.put(KEY, JSON.stringify({ stories: list, signature, updated: new Date(now).toISOString() }));
  return `wrote ${list.length}`;
}

export async function storedHeadlines(env) {
  if (!env.NEWS) return null;
  const s = await env.NEWS.get(KEY, 'json');
  const fresh = ((s && s.stories) || []).filter((x) => Date.now() - Date.parse(x.at) <= MAX_AGE_H * 36e5);   // if refreshing stalls, old headlines age out and the Wikipedia box takes over
  return fresh.length ? fresh.map((x) => ({ text: x.text, url: '' })) : null;
}
