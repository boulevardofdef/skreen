/* Skreen ↔ Google: reads Calendar and writes Tasks straight from the device, using a
   short-lived access token that the Android app obtains through Google's sign-in.
   There is no server of ours in the middle. Every call names the Google account it is for,
   so several accounts (Skreen+) can be shown at once. */
window.Google = (() => {
  const CAL = 'https://www.googleapis.com/calendar/v3';
  const TASKS = 'https://tasks.googleapis.com/tasks/v1';
  const DEFAULT_TASK_LIST = 'Household';

  let tokenProvider = null;   // (account) => Promise<token>
  const init = (getToken) => { tokenProvider = getToken; };

  class AuthError extends Error {}

  async function call(acct, url, opts = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let token;
      try { token = await tokenProvider(acct); } catch (e) { throw new AuthError(e.message || 'sign-in needed'); }
      const headers = { Authorization: 'Bearer ' + token };
      if (opts.body) headers['Content-Type'] = 'application/json';
      const res = await fetch(url, { ...opts, headers });
      if (res.status === 401) { if (attempt === 0) continue; throw new AuthError('expired'); }
      if (!res.ok) throw new Error('Google returned ' + res.status);
      return res.status === 204 ? null : res.json();
    }
  }

  // ── Calendar ──────────────────────────────────────────────────────────────

  const calCache = new Map();   // account → { at, items }
  async function listCalendars(acct, force = false) {
    const hit = calCache.get(acct);
    if (!force && hit && Date.now() - hit.at < 10 * 60000) return hit.items;
    const res = await call(acct, `${CAL}/users/me/calendarList?minAccessRole=reader&maxResults=250&fields=items(id,summary,summaryOverride,backgroundColor,primary,selected,hidden)`);
    const items = (res.items || []).map((c) => ({
      id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#e8c887',
      primary: !!c.primary, selected: !!c.selected && !c.hidden,
    }));
    calCache.set(acct, { at: Date.now(), items });
    return items;
  }

  // Calendars to show: the user's choice, or whatever is ticked in Google Calendar's sidebar.
  const chosenCalendars = (all, ids) => (ids && ids.length ? all.filter((c) => ids.includes(c.id)) : all.filter((c) => c.selected));

  async function events(acct, calendarIds, days = 7) {
    const all = await listCalendars(acct);
    const cals = chosenCalendars(all, calendarIds);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + days * 86400000);
    const q = new URLSearchParams({
      timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100',
      fields: 'items(id,iCalUID,summary,description,location,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),status,eventType,start,end,attendees(self,responseStatus))',
    });
    const lists = await Promise.all(cals.map(async (cal) => {
      const res = await call(acct, `${CAL}/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
      return (res.items || []).map((ev) => ({ ev, cal }));
    }));

    const out = [], seen = new Set();
    for (const { ev, cal } of lists.flat()) {
      if (ev.status === 'cancelled' || ev.eventType === 'workingLocation') continue;
      const me = (ev.attendees || []).find((a) => a.self);
      if (me && me.responseStatus === 'declined') continue;
      const allDay = !!(ev.start && ev.start.date);
      const item = {
        id: ev.id, uid: ev.iCalUID || ev.id, title: ev.summary || '(No title)', location: ev.location || '',
        calendar: cal.primary ? '' : cal.name, calendarName: cal.name, color: cal.color, allDay,
        description: (ev.description || '').slice(0, 2000),
        meet: ev.hangoutLink || (((ev.conferenceData || {}).entryPoints || []).find((e) => e.entryPointType === 'video') || {}).uri || '',
        start: allDay ? ev.start.date : ev.start.dateTime,
        end: allDay ? ev.end.date : ev.end.dateTime,   // all-day end is exclusive, as the display expects
      };
      const key = item.uid + '|' + item.start;
      if (seen.has(key)) continue;   // the same event can sit on several shared calendars
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  async function listTaskLists(acct) {
    const res = await call(acct, `${TASKS}/users/@me/lists?maxResults=100&fields=items(id,title)`);
    return (res.items || []).map((l) => ({ id: l.id, title: l.title }));
  }

  const defaultList = new Map();   // account → list id: resolved once, it rarely changes
  async function resolveList(acct, chosenId) {
    if (chosenId) return chosenId;
    if (defaultList.has(acct)) return defaultList.get(acct);
    const lists = await listTaskLists(acct);
    const pick = lists.find((l) => l.title.toLowerCase() === DEFAULT_TASK_LIST.toLowerCase());
    const id = pick ? pick.id : (lists[0] ? lists[0].id : '@default');   // Google lists the default list first
    defaultList.set(acct, id);
    return id;
  }

  async function tasks(acct, listId) {
    const base = `${TASKS}/lists/${encodeURIComponent(listId)}/tasks`;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [open, done] = await Promise.all([
      call(acct, `${base}?showCompleted=false&showHidden=false&maxResults=100&fields=items(id,title,notes,position,parent,status)`),
      call(acct, `${base}?showCompleted=true&showHidden=true&completedMin=${encodeURIComponent(since)}&maxResults=100&fields=items(id,title,notes,parent,status,completed)`),
    ]);
    const out = [];
    for (const t of (open.items || [])) if (t.title && !t.parent && t.status !== 'completed') out.push({ id: t.id, title: t.title, notes: t.notes || '', position: t.position, done: false });
    for (const t of (done.items || [])) if (t.title && !t.parent && t.status === 'completed' && t.completed) out.push({ id: t.id, title: t.title, notes: t.notes || '', done: true, completed: t.completed });
    return out;
  }

  const taskUrl = (listId, id) => `${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`;
  const patch = (acct, listId, id, body) => call(acct, taskUrl(listId, id), { method: 'PATCH', body: JSON.stringify(body) }).then(() => true);

  async function addTask(acct, listId, title, notes = '') {
    const body = { title: title.slice(0, 500) };
    if (notes) body.notes = notes;
    const t = await call(acct, `${TASKS}/lists/${encodeURIComponent(listId)}/tasks`, { method: 'POST', body: JSON.stringify(body) });
    return { id: t.id, title: t.title, notes: t.notes || '', position: t.position, done: false };
  }
  const setNotes = (acct, listId, id, notes) => patch(acct, listId, id, { notes: notes || null });
  const setTitle = (acct, listId, id, title) => patch(acct, listId, id, { title: String(title).slice(0, 500) });
  const setDone = (acct, listId, id, done) => patch(acct, listId, id, done ? { status: 'completed' } : { status: 'needsAction', completed: null });

  const forgetCaches = () => { calCache.clear(); defaultList.clear(); };

  return { init, AuthError, listCalendars, listTaskLists, resolveList, events, tasks, addTask, setDone, setNotes, setTitle, forgetCaches, chosenCalendars };
})();
