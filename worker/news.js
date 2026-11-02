// Headlines for the "In the news" widget and tour slide.
//
// Every 30 minutes (cron) this reads the top-stories feeds of about a dozen news outlets, plus Wikipedia's
// Current events pages, and asks a Claude model to choose the stories that matter and write its own short
// AP-style headlines. The outlets are read only as a signal of what is big (how many lead with a story, and
// how high); no outlet's wording or link is passed on. The result is kept in one KV entry. The model also
// sees the headlines it wrote last time, so a story stays while it is still news and makes way when its time
// is up. Wikipedia text is CC BY-SA; the app carries the credit.

const MODEL = 'claude-haiku-5-5';    // about $2 a month; claude-sonnet-5-5 (at low effort) is the step up if the headlines need more judgment
const KEEP = 8;             // the app shows the top 2 to 4
const LIFE_H = 4;           // an ordinary headline stays up this long, then makes way for others
const MAJOR_LIFE_H = 24;    // a true front-page story can stay up to a day (until a follow-up headline replaces it)
const MAJOR_OUTLETS = 6;    // "front page" means at least this many outlets are carrying it
const STRONG_OUTLETS = 5;   // a retired story may come back if this many outlets are still carrying it...
const COOLDOWN_H = 6;       // ...once it has been off for this long
const GRACE_H = 12;         // if refreshing fails, the last list is still served this long, then nothing
const RETIRED_H = 48;       // how long we remember retired headlines, so the same facts aren't put back up
const PER_FEED = 15;        // titles read from the top of each feed
const MIN_FEEDS = 4;        // fewer feeds than this answering and we don't trust the picture
const lifeMs = (h) => (h && h.major ? MAJOR_LIFE_H : LIFE_H) * 36e5;
const alive = (h, now) => now - Date.parse(h.at) <= lifeMs(h);
const KEY = 'headlines';

const FEEDS = [
  ['BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['BBC Top', 'https://feeds.bbci.co.uk/news/rss.xml'],
  ['BBC Business', 'https://feeds.bbci.co.uk/news/business/rss.xml'],
  ['Guardian World', 'https://www.theguardian.com/world/rss'],
  ['NPR', 'https://feeds.npr.org/1001/rss.xml'],
  ['Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'],
  ['NYT Home', 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml'],
  ['NYT Business', 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml'],
  ['CBS', 'https://www.cbsnews.com/latest/rss/main'],
  ['Sky', 'https://feeds.skynews.com/feeds/rss/world.xml'],
  ['DW', 'https://rss.dw.com/rdf/rss-en-all'],
  ['France 24', 'https://www.france24.com/en/rss'],
];

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Markup → plain text. Wiki links keep their label, external links are dropped, entities are decoded.
export function plain(w) {
  return w
    .replace(/<!\[CDATA\[|\]\]>/g, '')
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

// An RSS/RDF feed → the titles of its items, in the order the outlet put them.
export function feedTitles(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const t = m[1].match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const text = t ? plain(t[1]) : '';
    if (text.length > 12) out.push(text);
    if (out.length === PER_FEED) break;
  }
  return out;
}

// A Current events page → one entry per actual news item. Bullets nest: a shorter bullet is the topic
// ("2026 Toledo train collision"), the deepest ones are the items.
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
    if (isLeaf) out.push({ outlet: 'Wikipedia', day, cat, topic: ctx.slice(0, depth - 1).filter(Boolean).join(' / '), text });
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pageName = (d) => `Portal:Current_events/${d.getUTCFullYear()}_${MONTHS[d.getUTCMonth()]}_${d.getUTCDate()}`;

async function fetchDay(d, contact) {
  const res = await fetch(`https://en.wikipedia.org/w/index.php?title=${pageName(d)}&action=raw`, { headers: { 'User-Agent': contact }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  return parsePage(await res.text(), `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
}

async function fetchFeed([outlet, url], contact) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': contact, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { outlet, failed: `HTTP ${res.status}` };
    const titles = feedTitles(await res.text()).filter((t) => t !== 'DW');
    return titles.length ? { outlet, items: titles.map((text, i) => ({ outlet, pos: i + 1, text })) } : { outlet, failed: 'no items' };
  } catch (e) { return { outlet, failed: e.message }; }
}

// Everything the model gets to see: the outlets' headlines and, as a log of facts, Wikipedia's Current events.
export async function gather(contact, now = Date.now()) {
  const feeds = await Promise.all(FEEDS.map((f) => fetchFeed(f, contact)));
  const items = feeds.flatMap((f) => f.items || []);
  const failed = feeds.filter((f) => f.failed).map((f) => `${f.outlet} (${f.failed})`);
  const answered = feeds.length - failed.length;
  let wiki = [];
  try { wiki = (await Promise.all([new Date(now - 864e5), new Date(now)].map((d) => fetchDay(d, contact)))).flat(); } catch (_) {}
  return { items: [...items, ...wiki], answered, failed, signature: JSON.stringify(feeds.map((f) => (f.items || []).slice(0, 10).map((i) => i.text))) };
}

export const SYSTEM = `You are the news editor for a wall display in people's homes. You are given the current top headlines from a dozen news outlets (position 1 is the outlet's most prominent story) and a log of events from Wikipedia's Current events page. Use them for two things only: to judge what matters right now, and as a source of facts. Then choose the stories that matter most to a mainstream international audience and write your own headline for each.

Never copy an outlet's wording and never name an outlet. Write each headline fresh from the facts.

Headline rules:
- AP style: present tense for events that just happened, single quotes inside headlines, AP abbreviations and capitalization (write US, not U.S., in headlines), numerals for 10 and up, no period at the end.
- Brief, neutral and punchy: 75 characters or fewer, and never more than 85. Use short words. Cut to the single main fact.
- One idea per headline. Never join two clauses with a semicolon or a dash. If a story has two developments, write about the bigger one.
- Facts only. Use only what the items state. No adjectives that editorialize, no speculation, no questions. Where outlets give different numbers, use the lower one with "at least".
- A reader with no context must understand it: name the place or the person's role, not just a surname.
- Merge everything about the same event into one headline.

How to judge significance:
- The strongest signal is breadth: how many different outlets carry the story, and how high. A story that most outlets carry near the top is major news. A story only one or two outlets carry is minor, however important it sounds.
- Elevate stories that aren't routine. Ongoing wars and conflicts produce routine daily developments (strikes, casualty updates, talks), which are low priority unless something truly changes.
- The death of a globally famous person is a major story. So are a national leader's election, fall or death, a major disaster, and market or tech events with wide reach.
- Business news counts when it affects many countries or many people's lives (a major central bank, a market-wide shock, a very large company or hack). A smaller country's rate change, a routine data release or a single ordinary deal is low priority.
- Consider the list as a whole. A varied mix of topics and regions reads better on a wall than several stories of the same kind.
- Skip routine, local and niche items, and entertainment or sports unless the event is exceptional.

Rolling list and freshness:
- You also get the headlines you chose last time, each with its age.
- Headlines rotate. An ordinary headline stays up about ${LIFE_H} hours, then is retired so that other stories get a turn. Retired headlines are listed for you. Do not write them again unless the story is still carried by at least ${STRONG_OUTLETS} outlets, at least ${COOLDOWN_H} hours have passed since it was retired, and there is a new development; in that case write a new headline about the development.
- A true front-page story may stay up to ${MAJOR_LIFE_H} hours. Mark it "major": true, but only when at least ${MAJOR_OUTLETS} outlets are carrying it and every newsroom would lead with it. At most two at a time. Most headlines are not major.
- When a story develops, write a new headline about the new facts (it replaces the old one). Do not keep a headline whose facts have been overtaken.
- Keep a previous headline, text unchanged, only while its facts are unchanged, it is still being carried, and it is still among the most significant choices.
- Rank the list by significance, most significant first. Return at most ${KEEP}.

Reply with JSON only, no other text:
{"headlines":[{"text":"...","lines":[3,7,12],"prev":null,"major":false}]}
"lines" are the numbers of ALL the items, from every outlet, that are about that story (so we can count how many outlets carry it). "prev" is the id of the previous headline you are keeping unchanged, or null.`;

const keyOf = (it) => `${it.outlet}|${it.text}`;

export function buildPrompt(items, prev, now, retired = []) {
  const cur = items.map((it, i) => (it.outlet === 'Wikipedia'
    ? `${i + 1}. [Wikipedia log ${it.day}] ${it.cat}${it.topic ? ' / ' + it.topic : ''}: ${it.text}`
    : `${i + 1}. [${it.outlet} #${it.pos}] ${it.text}`)).join('\n');
  const old = prev.length
    ? prev.map((p, i) => `id ${i + 1} (${(Math.round((now - Date.parse(p.at)) / 36e4) / 10)}h old${p.major ? ', major' : ''}): ${p.text}`).join('\n')
    : '(none yet)';
  const gone = retired.length ? retired.map((r) => `- ${r.text} (retired ${Math.round((now - r.retiredAt) / 36e5)}h ago)`).join('\n') : '(none)';
  return `Current items:\n${cur}\n\nPrevious headlines:\n${old}\n\nRetired headlines:\n${gone}`;
}

const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
export function similar(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  let both = 0; for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= 0.5;
}

// The model's reply → a clean list, or null when it can't be trusted.
export function checkReply(reply, items, prev, now, retired = []) {
  let data;
  try { data = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch (_) { return null; }
  if (!data || !Array.isArray(data.headlines)) return null;
  const out = [];
  for (const h of data.headlines) {
    const text = String((h && h.text) || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
    const lines = Array.isArray(h && h.lines) ? [...new Set(h.lines.filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length))] : [];
    if (text.length < 15 || text.length > 90 || /https?:|www\./i.test(text) || !lines.length) continue;
    const src = lines.map((n) => keyOf(items[n - 1]));
    const outlets = new Set(lines.map((n) => items[n - 1]).filter((it) => it.outlet !== 'Wikipedia').map((it) => it.outlet)).size;
    const before = Number.isInteger(h.prev) && prev[h.prev - 1] && prev[h.prev - 1].text === text ? prev[h.prev - 1] : null;
    const at = before ? before.at : new Date(now).toISOString();
    const major = !!h.major && outlets >= MAJOR_OUTLETS && out.filter((o) => o.major).length < 2;   // front page means many outlets, whatever the model feels
    if (!alive({ at, major }, now)) continue;
    if (out.some((o) => o.text === text || similar(o.text, text))) continue;
    if (!before && retired.some((r) => (src.every((k) => r.src.includes(k)) || similar(text, r.text)) && !(outlets >= STRONG_OUTLETS && now - r.retiredAt >= COOLDOWN_H * 36e5))) continue;   // same story as a retired headline: not news again yet
    out.push({ text, at, src, major, outlets });
    if (out.length === KEEP) break;
  }
  return out.length >= 2 ? out : null;   // the app shows two at the least
}

async function ask(env, system, user) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const body = await res.json();
  if (body.stop_reason === 'max_tokens') throw new Error('the model ran out of room before finishing its reply');
  return (body.content || []).map((b) => b.text || '').join('');
}

// Run by the cron trigger. Any failure leaves the last good list in place.
export async function refreshNews(env, contact, now = Date.now()) {
  if (!env.NEWS || !env.ANTHROPIC_API_KEY) return 'not configured';
  const { items, answered, failed, signature } = await gather(contact, now);
  if (answered < MIN_FEEDS) return `too few feeds answered (${answered}); failed: ${failed.join(', ')}`;
  const stored = await env.NEWS.get(KEY, 'json');
  const old = (stored && stored.stories) || [];
  const here = new Set(items.map(keyOf));
  const prev = old.filter((p) => alive(p, now) && (p.src || []).some((k) => here.has(k)));   // a story no outlet carries any more, or whose time is up, is gone
  const retired = [
    ...((stored && stored.retired) || []),
    ...old.filter((p) => !alive(p, now)).map((p) => ({ ...p, retiredAt: Date.parse(p.at) + lifeMs(p) })),
  ].filter((r) => now - r.retiredAt <= RETIRED_H * 36e5).filter((r, i, all) => all.findIndex((x) => x.text === r.text) === i);
  if (stored && stored.signature === signature && prev.length === old.length) return 'unchanged';   // nothing new at the top of any feed, nothing expired
  const list = checkReply(await ask(env, SYSTEM, buildPrompt(items, prev, now, retired)), items, prev, now, retired);
  if (!list) return `rejected reply (${answered} feeds)`;
  await env.NEWS.put(KEY, JSON.stringify({ stories: list, retired, signature, updated: new Date(now).toISOString() }));
  return `wrote ${list.length} from ${answered} feeds${failed.length ? '; failed: ' + failed.join(', ') : ''}`;
}

export async function storedHeadlines(env) {
  if (!env.NEWS) return null;
  const s = await env.NEWS.get(KEY, 'json');
  const fresh = ((s && s.stories) || []).filter((x) => Date.now() - Date.parse(x.at) <= GRACE_H * 36e5);   // if refreshing stalls, the last list keeps showing for a while, then the app says it can't load the news
  return fresh.length ? fresh.map((x) => ({ text: x.text, url: '' })) : null;
}
