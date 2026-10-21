/* Skreen ↔ Google: reads Calendar and writes Tasks straight from the device, using a
   short-lived access token that the Android app obtains through Google's sign-in.
   There is no server of ours in the middle. */
window.Google = (() => {
  const CAL = 'https://www.googleapis.com/calendar/v3';
  const TASKS = 'https://tasks.googleapis.com/tasks/v1';
  const DEFAULT_TASK_LIST = 'Household';

  let tokenProvider = null;
  const init = (getToken) => { tokenProvider = getToken; };

  class AuthError extends Error {}

  async function call(url, opts = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let token;
      try { token = await tokenProvider(); } catch (e) { throw new AuthError(e.message || 'sign-in needed'); }
      const headers = { Authorization: 'Bearer ' + token };
      if (opts.body) headers['Content-Type'] = 'application/json';
      const res = await fetch(url, { ...opts, headers });
      if (res.status === 401) { if (attempt === 0) continue; throw new AuthError('expired'); }
      if (!res.ok) throw new Error('Google returned ' + res.status);
      return res.status === 204 ? null : res.json();
    }
  }

  // ── Calendar ──────────────────────────────────────────────────────────────

  let calCache = { at: 0, items: null };
  async function listCalendars(force = false) {
    if (!force && calCache.items && Date.now() - calCache.at < 10 * 60000) return calCache.items;
    const res = await call(`${CAL}/users/me/calendarList?minAccessRole=reader&maxResults=250&fields=items(id,summary,summaryOverride,backgroundColor,primary,selected,hidden)`);
    calCache = {
      at: Date.now(),
      items: (res.items || []).map((c) => ({
        id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#e8c887',
        primary: !!c.primary, selected: !!c.selected && !c.hidden,
      })),
    };
    return calCache.items;
  }

  // Calendars to show: the user's choice, or whatever is ticked in Google Calendar's sidebar.
  const chosenCalendars = (all, ids) => (ids && ids.length ? all.filter((c) => ids.includes(c.id)) : all.filter((c) => c.selected));

  async function events(calendarIds, days = 7) {
    const all = await listCalendars();
    const cals = chosenCalendars(all, calendarIds);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + days * 86400000);
    const q = new URLSearchParams({
      timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100',
      fields: 'items(id,iCalUID,summary,description,location,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),status,eventType,start,end,attendees(self,responseStatus))',
    });
    const lists = await Promise.all(cals.map(async (cal) => {
      const res = await call(`${CAL}/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
      return (res.items || []).map((ev) => ({ ev, cal }));
    }));

    const out = [], seen = new Set();
    for (const { ev, cal } of lists.flat()) {
      if (ev.status === 'cancelled' || ev.eventType === 'workingLocation') continue;
      const me = (ev.attendees || []).find((a) => a.self);
      if (me && me.responseStatus === 'declined') continue;
      const allDay = !!(ev.start && ev.start.date);
      const item = {
        id: ev.id, title: ev.summary || '(No title)', location: ev.location || '',
        calendar: cal.primary ? '' : cal.name, calendarName: cal.name, color: cal.color, allDay,
        description: (ev.description || '').slice(0, 2000),
        meet: ev.hangoutLink || (((ev.conferenceData || {}).entryPoints || []).find((e) => e.entryPointType === 'video') || {}).uri || '',
        start: allDay ? ev.start.date : ev.start.dateTime,
        end: allDay ? ev.end.date : ev.end.dateTime,   // all-day end is exclusive, as the display expects
      };
      const key = (ev.iCalUID || ev.id) + '|' + item.start;
      if (seen.has(key)) continue;   // the same event can sit on several shared calendars
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  async function listTaskLists() {
    const res = await call(`${TASKS}/users/@me/lists?maxResults=100&fields=items(id,title)`);
    return (res.items || []).map((l) => ({ id: l.id, title: l.title }));
  }

  let listCache = null;   // "which list?" rarely changes; resolve it once per chosen id
  async function resolveList(chosenId) {
    if (chosenId) return chosenId;
    if (listCache) return listCache;
    const lists = await listTaskLists();
    const pick = lists.find((l) => l.title.toLowerCase() === DEFAULT_TASK_LIST.toLowerCase());
    listCache = pick ? pick.id : '@default';
    return listCache;
  }

  async function tasks(chosenId) {
    const listId = await resolveList(chosenId);
    const base = `${TASKS}/lists/${encodeURIComponent(listId)}/tasks`;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [open, done] = await Promise.all([
      call(`${base}?showCompleted=false&showHidden=false&maxResults=100&fields=items(id,title,notes,position,parent,status)`),
      call(`${base}?showCompleted=true&showHidden=true&completedMin=${encodeURIComponent(since)}&maxResults=100&fields=items(id,title,notes,parent,status,completed)`),
    ]);
    const out = [];
    for (const t of (open.items || [])) if (t.title && !t.parent && t.status !== 'completed') out.push({ id: t.id, title: t.title, notes: t.notes || '', position: t.position, done: false });
    for (const t of (done.items || [])) if (t.title && !t.parent && t.status === 'completed' && t.completed) out.push({ id: t.id, title: t.title, notes: t.notes || '', done: true, completed: t.completed });
    return out;
  }

  async function addTask(chosenId, title, notes = '') {
    const listId = await resolveList(chosenId);
    const body = { title: title.slice(0, 500) };
    if (notes) body.notes = notes;
    const t = await call(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks`, { method: 'POST', body: JSON.stringify(body) });
    return { id: t.id, title: t.title, notes: t.notes || '', position: t.position, done: false };
  }

  async function setDone(chosenId, id, done) {
    const listId = await resolveList(chosenId);
    const body = done ? { status: 'completed' } : { status: 'needsAction', completed: null };
    await call(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    return true;
  }

  const forgetCaches = () => { calCache = { at: 0, items: null }; listCache = null; };

  return { init, AuthError, listCalendars, listTaskLists, events, tasks, addTask, setDone, forgetCaches, chosenCalendars };
})();
