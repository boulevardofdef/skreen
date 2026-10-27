/* Skreen ↔ Google: reads Calendar and writes Tasks straight from the device, using a
   short-lived access token that the Android app obtains through Google's sign-in.
   There is no server of ours in the middle. Every call names the Google account it is for,
   so several accounts (Skreen+) can be shown at once. */
window.Google = (() => {
  const CAL = 'https://www.googleapis.com/calendar/v3';
  const TASKS = 'https://tasks.googleapis.com/tasks/v1';
  const DEFAULT_TASK_LIST = 'Household';

  let tokenProvider = null;   // (account) => Promise<token>
  let onExpired = null;       // (account) => void: called when Google keeps refusing the token, so the app can drop it
  const init = (getToken, expired) => { tokenProvider = getToken; onExpired = expired || null; };

  class AuthError extends Error {}
  class QuotaError extends Error {}   // Google says too many requests: back off and keep showing what we have

  async function call(acct, url, opts = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let token;
      try { token = await tokenProvider(acct); } catch (e) { throw new AuthError(e.message || 'sign-in needed'); }
      const headers = { Authorization: 'Bearer ' + token };
      if (opts.body) headers['Content-Type'] = 'application/json';
      const res = await fetch(url, { ...opts, headers });
      if (res.status === 401) { if (attempt === 0) continue; if (onExpired) { try { onExpired(acct); } catch (_) {} } throw new AuthError('expired'); }
      if (res.status === 429) throw new QuotaError('quota');
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

  // One request per check: the open tasks. The "done in the last 24 hours" list is fetched again only when the
  // set of open tasks changed (or now and then), because that's the only time it can have changed.
  const taskMemo = new Map();
  async function tasks(acct, listId) {
    const base = `${TASKS}/lists/${encodeURIComponent(listId)}/tasks`;
    const open = await call(acct, `${base}?showCompleted=false&showHidden=false&maxResults=100&fields=items(id,title,notes,position,parent,status)`);
    const out = [];
    for (const t of (open.items || [])) if (t.title && !t.parent && t.status !== 'completed') out.push({ id: t.id, title: t.title, notes: t.notes || '', position: t.position, done: false });
    const key = `${acct}|${listId}`, ids = out.map((t) => t.id).sort().join(',');
    let memo = taskMemo.get(key);
    if (!memo || memo.ids !== ids || Date.now() - memo.at > 3600 * 1000) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const done = await call(acct, `${base}?showCompleted=true&showHidden=true&completedMin=${encodeURIComponent(since)}&maxResults=100&fields=items(id,title,notes,parent,status,completed)`);
      const list = [];
      for (const t of (done.items || [])) if (t.title && !t.parent && t.status === 'completed' && t.completed) list.push({ id: t.id, title: t.title, notes: t.notes || '', done: true, completed: t.completed });
      memo = { ids, done: list, at: Date.now() };
      taskMemo.set(key, memo);
    }
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return out.concat(memo.done.filter((t) => Date.parse(t.completed) > cutoff));
  }

  const taskUrl = (listId, id) => `${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`;
  const patch = (acct, listId, id, body) => call(acct, taskUrl(listId, id), { method: 'PATCH', body: JSON.stringify(body) }).then(() => true);

  async function addTask(acct, listId, title, notes = '', previousId = '') {
    const body = { title: title.slice(0, 500) };
    if (notes) body.notes = notes;
    // Google puts a new task at the top; `previous` places it after that task (the bottom, for a shopping list).
    const t = await call(acct, `${TASKS}/lists/${encodeURIComponent(listId)}/tasks${previousId ? `?previous=${encodeURIComponent(previousId)}` : ''}`, { method: 'POST', body: JSON.stringify(body) });
    return { id: t.id, title: t.title, notes: t.notes || '', position: t.position, done: false };
  }
  const setNotes = (acct, listId, id, notes) => patch(acct, listId, id, { notes: notes || null });
  const setTitle = (acct, listId, id, title) => patch(acct, listId, id, { title: String(title).slice(0, 500) });
  const setDone = (acct, listId, id, done) => { taskMemo.delete(`${acct}|${listId}`); return patch(acct, listId, id, done ? { status: 'completed' } : { status: 'needsAction', completed: null }); };

  // Dinner planner: tasks whose due date falls in [from, to] (YYYY-MM-DD). Google keeps a task's due
  // date as midnight UTC of that day, so the date part is the day itself.
  async function mealTasks(acct, listId, from, to) {
    const base = `${TASKS}/lists/${encodeURIComponent(listId)}/tasks`;
    const q = new URLSearchParams({ showCompleted: 'true', showHidden: 'true', maxResults: '100', dueMin: `${from}T00:00:00.000Z`, dueMax: `${to}T23:59:59.000Z`, fields: 'items(id,title,due,status,parent)' });
    const res = await call(acct, `${base}?${q}`);
    return (res.items || []).filter((t) => t.title && t.due && !t.parent).map((t) => ({ id: t.id, title: t.title, date: t.due.slice(0, 10), done: t.status === 'completed' }));
  }
  // The list's undated tasks: the pool of meal ideas to pick from.
  async function mealIdeas(acct, listId) {
    const res = await call(acct, `${TASKS}/lists/${encodeURIComponent(listId)}/tasks?showCompleted=false&showHidden=false&maxResults=100&fields=items(id,title,due,parent,position)`);
    return (res.items || []).filter((t) => t.title && !t.due && !t.parent).sort((a, b) => ((a.position || '') < (b.position || '') ? -1 : 1)).map((t) => ({ id: t.id, title: t.title }));
  }
  async function addMeal(acct, listId, title, date) {
    const t = await call(acct, `${TASKS}/lists/${encodeURIComponent(listId)}/tasks`, { method: 'POST', body: JSON.stringify({ title: title.slice(0, 500), due: `${date}T00:00:00.000Z` }) });
    return { id: t.id, title: t.title, date, done: false };
  }
  const deleteTask = (acct, listId, id) => call(acct, taskUrl(listId, id), { method: 'DELETE' }).then(() => true);

  const forgetCaches = () => { calCache.clear(); defaultList.clear(); taskMemo.clear(); };

  return { init, AuthError, QuotaError, listCalendars, listTaskLists, resolveList, events, tasks, addTask, setDone, setNotes, setTitle, mealTasks, mealIdeas, addMeal, deleteTask, forgetCaches, chosenCalendars };
})();
