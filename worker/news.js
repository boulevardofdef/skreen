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

export function buildPrompt(items, prev, now, retired = []) {
  const cur = items.map((it, i) => `${i + 1}. [${it.day}] ${it.cat}${it.topic ? ' / ' + it.topic : ''}: ${it.text}`).join('\n');
  const old = prev.length
    ? prev.map((p, i) => `id ${i + 1} (${(Math.round((now - Date.parse(p.at)) / 36e4) / 10)}h old${p.major ? ', major' : ''}): ${p.text}\n   from: ${p.src.join(' | ')}`).join('\n')
    : '(none yet)';
  const gone = retired.length ? retired.map((r) => `- ${r.text}`).join('\n') : '(none)';
  return `Current items:\n${cur}\n\nPrevious headlines:\n${old}\n\nRetired headlines (do not repeat):\n${gone}`;
}

// The model's reply → a clean list, or null when it can't be trusted.
export function checkReply(reply, items, prev, now, retired = []) {
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
export async function refreshNews(env, contact, now = Date.now()) {
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

export async function storedHeadlines(env) {
  if (!env.NEWS) return null;
  const s = await env.NEWS.get(KEY, 'json');
  const fresh = ((s && s.stories) || []).filter((x) => alive(x, Date.now()));   // if refreshing stalls, old headlines age out and the Wikipedia box takes over
  return fresh.length ? fresh.map((x) => ({ text: x.text, url: '' })) : null;
}
