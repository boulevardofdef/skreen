// Other calendars: any published calendar link (.ics / webcal://). This is how Outlook, Apple
// iCloud, Yahoo, Fastmail and most others can be shown without signing in to them. The link
// is fetched through Skreen's relay (browsers can't read most calendar hosts directly), then
// parsed here with ical.js (vendor/ical.min.js), including repeating events.
const Ics = (() => {
  const VIDEO = /https?:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com|[\w.-]*webex\.com)[^\s<>"')]*/i;
  const COLORS = ['#4fb3ff', '#5fbf8f', '#f2c94c', '#ff7a59', '#c792ea', '#ff8fb8', '#9aa5ff', '#7fd6d0'];
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (t) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;

  // ical.js reads a time with no zone as UTC; calendars mean "the viewer's local time" there.
  const jsDate = (t) => (t.zone && t.zone.tzid === 'floating'
    ? new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
    : t.toJSDate());

  const cache = new Map();   // link → { at, text }
  async function fetchText(link) {
    const hit = cache.get(link);
    if (hit && Date.now() - hit.at < 4 * 60000) return hit.text;
    const res = await fetch(`${Weather.relay}/ics?u=${encodeURIComponent(link)}`);
    if (!res.ok) {
      let why = '';
      try { why = (await res.json()).error || ''; } catch (_) {}
      throw new Error(why || 'HTTP ' + res.status);
    }
    const text = await res.text();
    cache.set(link, { at: Date.now(), text });
    return text;
  }

  // One calendar's events inside [from, to).
  function expand(text, src, from, to) {
    const root = new ICAL.Component(ICAL.parse(text));
    root.getAllSubcomponents('vtimezone').forEach((tz) => {
      try { ICAL.TimezoneService.register(tz); } catch (_) {}
    });
    const masters = new Map(), exceptions = [], singles = [];
    for (const vevent of root.getAllSubcomponents('vevent')) {
      const ev = new ICAL.Event(vevent);
      if (ev.isRecurrenceException()) exceptions.push(ev);
      else if (vevent.hasProperty('rrule') || vevent.hasProperty('rdate')) masters.set(ev.uid, ev);
      else singles.push(ev);
    }
    for (const ex of exceptions) {
      const m = masters.get(ex.uid);
      if (m) m.relateException(ex); else singles.push(ex);   // a stray exception still shows
    }

    const out = [];
    const emit = (ev, start, end, idSuffix) => {
      if ((ev.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
      const allDay = start.isDate;
      const s = allDay ? ymd(start) : jsDate(start).toISOString();
      let e;
      if (allDay) e = ymd(end && end.compare(start) > 0 ? end : start.clone().adjust(1, 0, 0, 0));
      else e = jsDate(end || start).toISOString();
      const startMs = allDay ? new Date(start.year, start.month - 1, start.day).getTime() : jsDate(start).getTime();
      const endMs = allDay ? new Date(...[...e.split('-')].map((v, i) => (i === 1 ? +v - 1 : +v))).getTime() : jsDate(end || start).getTime();
      if (endMs <= from.getTime() && startMs < from.getTime()) return;
      if (startMs >= to.getTime()) return;
      const location = ev.location || '', description = ev.description || '';
      const video = (location + ' ' + description).match(VIDEO);
      out.push({
        id: `ics:${src.id}:${ev.uid}${idSuffix || ''}`, title: ev.summary || '(No title)', location,
        calendar: src.name, calendarName: src.name, color: src.color, allDay,
        description: description.slice(0, 2000), meet: video ? video[0] : '', start: s, end: e,
      });
    };

    for (const ev of singles) emit(ev, ev.startDate, ev.endDate);
    for (const ev of masters.values()) {
      const it = ev.iterator();
      for (let n = 0, next; n < 800 && (next = it.next()); n++) {
        if (jsDate(next).getTime() >= to.getTime()) break;
        const d = ev.getOccurrenceDetails(next);
        emit(d.item, d.startDate, d.endDate, '|' + ymd(d.startDate));
      }
    }
    return out;
  }

  async function events(sources, days) {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + days * 86400000);
    const lists = await Promise.all((sources || []).map(async (src) => {
      try { return expand(await fetchText(src.url), src, from, to); }
      catch (err) { console.warn('Calendar link failed', src.name, err); return []; }
    }));
    return lists.flat();
  }

  // For the Settings screen: fetch once and say how many upcoming events were found.
  async function test(link) {
    const text = await fetchText(link);
    const list = expand(text, { id: 'test', name: '', color: '#fff' }, new Date(Date.now() - 86400000), new Date(Date.now() + 30 * 86400000));
    let name = '';
    try { name = new ICAL.Component(ICAL.parse(text)).getFirstPropertyValue('x-wr-calname') || ''; } catch (_) {}
    return { count: list.length, name };
  }

  return { events, test, COLORS };
})();
