/* Skreen — wall display for calendar, to-dos, weather and backgrounds. */
(() => {
  'use strict';

  // ─── Settings (stored on this device) ──────────────────────────────────────

  const DEFAULTS = {
    backendUrl: '', secret: '',
    lat: null, lon: null, place: '',
    units: 'fahrenheit', clock: '12',
    bg: 'auto', font: 'bricolage',
    showcaseMinutes: '5', pixelShift: '1',
    nightEnabled: '1', nightStart: '22:30', nightEnd: '06:00',
    dayBrightness: 'system', nightBrightness: '3',
    signedIn: false, calendarIds: [], taskListId: '', welcomed: false, people: [],
  };
  const STORE_KEY = 'skreen-settings';
  const LEGACY_KEY = 'kitchen-dashboard-settings';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_KEY) || '{}';
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (_) { return { ...DEFAULTS }; }
  }
  function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (_) {} }

  let cfg = loadSettings();
  // Where the data comes from: Google sign-in (Android app), the older Apps Script, or sample data.
  const canSignIn = () => !!(window.SkreenNative && window.SkreenNative.signIn);
  const usingGoogle = () => canSignIn() && !!cfg.signedIn;
  const usingScript = () => !usingGoogle() && !!cfg.backendUrl;
  const isDemo = () => !usingGoogle() && !usingScript();

  // A link like  …/?backend=URL&key=SECRET  configures a device without typing.
  (function importLink() {
    try {
      const u = new URL(location.href);
      const b = u.searchParams.get('backend'), k = u.searchParams.get('key');
      if (!b && !k) return;
      if (b) cfg.backendUrl = b;
      if (k) cfg.secret = k;
      saveSettings();
      u.searchParams.delete('backend'); u.searchParams.delete('key');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (_) {}
  })();

  const REFRESH_DATA_MS = 2 * 60 * 1000;
  const REFRESH_WEATHER_MS = 15 * 60 * 1000;
  const AGENDA_DAYS = 7;
  const DAY_MS = 86400000;
  const DONE_KEEP_MS = DAY_MS;          // checked-off items stay for 24 hours
  const TOUR_VIEW_MS = 7500;            // 4 views ≈ 30 seconds

  // Present only inside the Skreen Android app.
  const NATIVE = window.SkreenNative || null;
  if (NATIVE) document.body.classList.add('native');

  const $ = (id) => document.getElementById(id);
  const clockHtml = (hm) => hm.replace(':', '<span class="colon">:</span>');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const FONTS = ['bricolage', 'fraunces', 'archivo', 'space', 'shoulders'];
  const applyFont = (f) => { document.body.dataset.font = FONTS.includes(f) ? f : 'bricolage'; };
  applyFont(cfg.font);

  // Static icons
  $('addIcon').innerHTML = Icons.plus;
  $('gearBtn').innerHTML = Icons.gear;
  $('micBtn').innerHTML = Icons.mic;
  $('locGps').innerHTML = Icons.pin;
  $('guideArrow').innerHTML = Icons.arrow;
  $('guideClose').innerHTML = Icons.close;

  // ─── State ─────────────────────────────────────────────────────────────────

  const state = {
    events: [], tasks: [], weather: null,
    lastSync: null, syncError: null,
    mutating: 0, lastMutation: 0,
    nightDismissedUntil: 0,
    bgKey: '',
    update: null, updating: null,
  };

  // ─── Backend ───────────────────────────────────────────────────────────────

  async function api(action, params = {}) {
    const url = new URL(cfg.backendUrl);
    url.searchParams.set('action', action);
    url.searchParams.set('key', cfg.secret);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('_', Date.now());
    const res = await fetch(url.toString(), { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  // Android app: ask the native side for a Google access token.
  const pendingTokens = new Map();
  let tokenSeq = 0;
  window.skreenToken = (id, token, err) => {
    const p = pendingTokens.get(id);
    if (!p) return;
    pendingTokens.delete(id);
    if (token) p.resolve(token); else p.reject(new Error(err || 'no token'));
  };
  const nativeToken = (method) => new Promise((resolve, reject) => {
    const id = ++tokenSeq;
    pendingTokens.set(id, { resolve, reject });
    try { NATIVE[method](id); } catch (e) { pendingTokens.delete(id); reject(e); }
    setTimeout(() => { if (pendingTokens.has(id)) { pendingTokens.delete(id); reject(new Error('timed out')); } }, method === 'signIn' ? 300000 : 30000);
  });
  if (NATIVE && NATIVE.getToken) Google.init(() => nativeToken('getToken'));

  // One interface, whichever source is in use.
  const backend = {
    async dashboard() {
      if (usingGoogle()) {
        const [events, tasks] = await Promise.all([Google.events(cfg.calendarIds, AGENDA_DAYS), Google.tasks(cfg.taskListId)]);
        return { events, tasks };
      }
      const d = await api('dashboard');
      return { events: d.events || [], tasks: d.tasks || [] };
    },
    async addTask(title, who = []) {
      const notes = buildNotes(who);
      if (usingGoogle()) return Google.addTask(cfg.taskListId, title, notes);
      return (await api('addTask', { title, notes })).task;
    },
    async setNotes(id, notes) {
      if (usingGoogle()) return Google.setNotes(cfg.taskListId, id, notes);
      return api('setNotes', { id, notes });
    },
    async setDone(id, done) {
      if (usingGoogle()) return Google.setDone(cfg.taskListId, id, done);
      return api(done ? 'completeTask' : 'uncompleteTask', { id });
    },
  };

  async function refreshData() {
    if (isDemo()) {
      state.events = demoEvents();
      state.tasks = decorateTasks(demoTasks.load());
      state.lastSync = new Date();
      renderAll();
      return;
    }
    try {
      const data = await backend.dashboard();
      state.events = data.events;
      // Don't clobber the list while a tap is still being saved.
      if (!state.mutating && Date.now() - state.lastMutation > 4000) state.tasks = decorateTasks(data.tasks);
      state.lastSync = new Date();
      state.syncError = null;
    } catch (err) {
      state.syncError = err instanceof Google.AuthError ? 'auth' : (err.message || String(err));
      console.warn('Sync failed', err);
    }
    renderAll();
  }

  function renderAll() {
    renderAgenda();
    renderTasks();
    renderStatus();
    applyBackground();
    updateNight();
  }

  // ─── Time helpers ──────────────────────────────────────────────────────────

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  function timeParts(d) {
    if (cfg.clock === '24') return { hm: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), ap: '' };
    return { hm: (d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0'), ap: d.getHours() < 12 ? 'AM' : 'PM' };
  }
  function fmtTime(d, { small = false } = {}) {
    const { hm, ap } = timeParts(d);
    if (!ap) return hm;
    return small ? `${hm}<small>${ap}</small>` : `${hm} ${ap}`;
  }
  const fmtDate = (d, opts) => d.toLocaleDateString(undefined, opts);
  const shortHour = (d) => (cfg.clock === '24' ? timeParts(d).hm : `${d.getHours() % 12 || 12} ${d.getHours() < 12 ? 'AM' : 'PM'}`);

  function relMinutes(mins) {
    if (mins < 1) return 'Starting now';
    if (mins < 60) return `In ${Math.round(mins)} min`;
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return m ? `In ${h} hr ${m} min` : `In ${h} hr`;
  }

  // ─── Clock ─────────────────────────────────────────────────────────────────

  let lastMinute = -1;
  function tick() {
    const now = new Date();
    const { hm, ap } = timeParts(now);
    $('time').innerHTML = clockHtml(hm);
    $('ampm').textContent = ap;
    $('date').textContent = fmtDate(now, { weekday: 'short', month: 'long', day: 'numeric' });

    if (now.getMinutes() !== lastMinute) {
      lastMinute = now.getMinutes();
      renderAgenda();
      renderTasks();           // retires checked-off items after 24 hours
      applyBackground();       // new day → new background
      updateNight(now);
      nudgeLayout(now);
      applyBrightness(now);
      maybeStartTour(now);
      // Fresh start every night: picks up app updates and keeps memory tidy.
      if (now.getHours() === 3 && now.getMinutes() === 30) location.reload();
    }
    setTimeout(tick, 1000 - now.getMilliseconds() + 5);
  }

  // Android app only: set the screen's own brightness (the best burn-in protection there is).
  function applyBrightness(now = new Date()) {
    if (!NATIVE) return;
    let level = -1;
    if (isNight(now)) level = Number(cfg.nightBrightness) / 100;
    else if (cfg.dayBrightness !== 'system') level = Number(cfg.dayBrightness) / 100;
    try { NATIVE.setBrightness(level); } catch (_) {}
  }

  // Slide the whole layout a few pixels, slowly, so no edge stays on the same pixels.
  function nudgeLayout(now) {
    const targets = [$('dash'), $('gearBtn'), $('status')];
    if (cfg.pixelShift !== '1') { targets.forEach((el) => { el.style.transform = ''; }); return; }
    const m = Math.floor(now.getTime() / 60000);
    const t = `translate(${Math.round(Math.sin(m / 11) * 7)}px, ${Math.round(Math.cos(m / 13) * 5)}px)`;
    targets.forEach((el) => { el.style.transform = t; });
  }

  // ─── Agenda ────────────────────────────────────────────────────────────────

  const normalizeEvent = (e) => (e.allDay ? { ...e, s: parseDate(e.start), e: parseDate(e.end) } : { ...e, s: new Date(e.start), e: new Date(e.end) });

  const evKey = (ev) => `${ev.id}|${ev.start}`;
  let agendaIndex = new Map();

  function renderAgenda() {
    const el = $('agenda');
    agendaIndex = new Map();
    const now = new Date();
    const today = startOfDay(now);
    const events = state.events.map(normalizeEvent);
    let html = '';

    for (let i = 0; i < AGENDA_DAYS; i++) {
      const dayStart = addDays(today, i), dayEnd = addDays(today, i + 1);
      const inDay = events.filter((ev) => ev.s < dayEnd && ev.e > dayStart);
      const allDay = inDay.filter((ev) => ev.allDay);
      let timed = inDay.filter((ev) => !ev.allDay).sort((a, b) => a.s - b.s);
      const endedToday = i === 0 ? timed.filter((ev) => ev.e <= now).length : 0;
      if (i === 0) timed = timed.filter((ev) => ev.e > now);
      if (i > 0 && !allDay.length && !timed.length) continue;

      const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(dayStart, { weekday: 'long' });
      const sub = fmtDate(dayStart, { month: 'short', day: 'numeric' });

      html += `<div class="day${i >= 2 ? ' later' : ''}">`;
      html += `<div class="day-head"><span class="name">${name}</span><span>${esc(sub)}</span></div>`;
      if (allDay.length) {
        html += '<div class="allday">' + allDay.map((ev) => { agendaIndex.set(evKey(ev), ev); return `<span class="pill" data-key="${esc(evKey(ev))}" style="--c:${esc(ev.color || '#e8c887')}">${esc(ev.title)}</span>`; }).join('') + '</div>';
      }
      if (i === 0 && !timed.length) {
        html += `<div class="empty">${endedToday ? Icons.check : Icons.sunny}${endedToday ? 'That’s everything for today' : 'Nothing scheduled today'}</div>`;
      }
      html += timed.map((ev) => eventCard(ev, now, dayStart, dayEnd)).join('');
      html += '</div>';
    }
    el.innerHTML = html;
  }

  function eventCard(ev, now, dayStart, dayEnd) {
    const running = ev.s <= now && ev.e > now;
    const minsAway = (ev.s - now) / 60000;
    const soon = !running && minsAway >= 0 && minsAway <= 60;

    let start, end;
    if (ev.s < dayStart && ev.e > dayEnd) { start = 'All day'; end = ''; }
    else if (ev.s < dayStart) { start = 'Until'; end = fmtTime(ev.e); }
    else { start = fmtTime(ev.s, { small: true }); end = ev.e <= dayEnd ? fmtTime(ev.e) : 'Overnight'; }

    const chip = running ? '<span class="chip">Now</span>' : soon ? `<span class="chip">${relMinutes(minsAway)}</span>` : '';
    const meta = ev.location ? `${Icons.pin}${esc(ev.location.split('\n')[0])}` : ev.calendar ? esc(ev.calendar) : '';
    const progress = running ? `<div class="progress" style="width:${Math.min(100, ((now - ev.s) / (ev.e - ev.s)) * 100).toFixed(1)}%"></div>` : '';

    agendaIndex.set(evKey(ev), ev);
    return `<div class="event${running ? ' now' : ''}" data-key="${esc(evKey(ev))}" style="--c:${esc(ev.color || '#e8c887')}">
      <div class="when"><div class="start">${start}</div>${end ? `<div class="end">${end}</div>` : ''}</div>
      <div><div class="title">${esc(ev.title)}${chip}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>${progress}
    </div>`;
  }

  // ─── Event details ─────────────────────────────────────────────────────────

  const eventSheet = $('eventSheet');
  let eventTimer = null;

  // Calendar descriptions are often HTML; turn them into plain text (never into live markup).
  function plainText(html) {
    if (!html) return '';
    const withBreaks = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ');
    const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
    doc.querySelectorAll('script, style').forEach((n) => n.remove());
    const text = doc.body.textContent || '';
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const durationText = (mins) => (mins < 60 ? `${mins} min` : mins % 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins / 60} hr`);

  function showEvent(ev) {
    const longDate = { weekday: 'long', month: 'long', day: 'numeric' };
    let when;
    if (ev.allDay) {
      const last = addDays(ev.e, -1);
      when = last > ev.s
        ? `${esc(fmtDate(ev.s, longDate))}<small>to ${esc(fmtDate(last, longDate))} · All day</small>`
        : `${esc(fmtDate(ev.s, longDate))}<small>All day</small>`;
    } else {
      const sameDay = startOfDay(ev.s).getTime() === startOfDay(new Date(ev.e - 1)).getTime();
      const mins = Math.round((ev.e - ev.s) / 60000);
      when = sameDay
        ? `${esc(fmtDate(ev.s, longDate))}<small>${esc(fmtTime(ev.s))} – ${esc(fmtTime(ev.e))} · ${durationText(mins)}</small>`
        : `${esc(fmtDate(ev.s, longDate))}, ${esc(fmtTime(ev.s))}<small>until ${esc(fmtDate(ev.e, { weekday: 'long', month: 'short', day: 'numeric' }))}, ${esc(fmtTime(ev.e))}</small>`;
    }
    const rows = [['When', when]];
    if (ev.location) rows.push(['Where', esc(ev.location)]);
    if (ev.meet && ev.meet !== ev.location) rows.push(['Video', esc(ev.meet)]);
    const cal = ev.calendarName || ev.calendar;
    if (cal) rows.push(['Calendar', `<i></i>${esc(cal)}`]);
    const notes = plainText(ev.description);
    if (notes) rows.push(['Notes', esc(notes)]);

    eventSheet.style.setProperty('--c', ev.color || '#ff5b2e');
    $('evTitle').textContent = ev.title;
    $('evRows').innerHTML = rows.map(([k, v]) => `<div class="ev-row" style="--c:${esc(ev.color || '#e8c887')}"><b>${k}</b><div>${v}</div></div>`).join('');
    if (!eventSheet.open) eventSheet.showModal();
    $('evRows').scrollTop = 0;
    // A wall display shouldn't be left showing a pop-up.
    clearTimeout(eventTimer);
    eventTimer = setTimeout(() => { if (eventSheet.open) eventSheet.close(); }, 90000);
  }
  $('agenda').addEventListener('click', (e) => {
    const el = e.target.closest('[data-key]');
    const ev = el && agendaIndex.get(el.dataset.key);
    if (ev) showEvent(ev);
  });
  $('evClose').addEventListener('click', () => eventSheet.close());
  eventSheet.addEventListener('click', (e) => { if (e.target === eventSheet) eventSheet.close(); });
  eventSheet.addEventListener('close', () => clearTimeout(eventTimer));

  // ─── Who is it for? ────────────────────────────────────────────────────────
  // A task's notes can start with a line of @names ("@Dan @Steve"); anything below it is left alone.
  // The names live in Google Tasks itself, so the list is the single source of truth. This device only
  // remembers the names it has seen, to offer them in the Add dialog. Colours come from the name.

  const PEOPLE_COLORS = ['#ff7a59', '#f2c94c', '#5fbf8f', '#4fb3ff', '#9aa5ff', '#e58bd0', '#7fd6d1', '#c8e06a'];
  const nameKey = (n) => String(n).trim().toLowerCase();
  const personColor = (n) => {
    let h = 0;
    for (const ch of nameKey(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PEOPLE_COLORS[h % PEOPLE_COLORS.length];
  };
  const TAG_LINE = /^(?:@[^\s@]+\s*)+$/;

  function parseNotes(notes) {
    const text = notes || '';
    const nl = text.indexOf('\n');
    const first = (nl < 0 ? text : text.slice(0, nl)).trim();
    if (first && TAG_LINE.test(first)) {
      return { who: first.match(/@[^\s@]+/g).map((t) => t.slice(1).replace(/_/g, ' ')), rest: nl < 0 ? '' : text.slice(nl + 1) };
    }
    return { who: [], rest: text };
  }
  const buildNotes = (who, rest = '') => [who.map((n) => '@' + n.trim().replace(/\s+/g, '_')).join(' '), rest].filter(Boolean).join('\n');

  const displayName = (raw) => {
    const known = (cfg.people || []).find((n) => nameKey(n) === nameKey(raw));
    return known || (raw.charAt(0).toUpperCase() + raw.slice(1));
  };
  function rememberPeople(names) {
    const have = new Set((cfg.people || []).map(nameKey));
    let changed = false;
    names.forEach((n) => { if (n && !have.has(nameKey(n))) { cfg.people = [...(cfg.people || []), n].slice(-12); have.add(nameKey(n)); changed = true; } });
    if (changed) saveSettings();
  }
  function decorateTasks(list) {
    list.forEach((t) => {
      if (typeof t.notes === 'string') {
        const seen = [];
        t.who = parseNotes(t.notes).who.filter((n) => !seen.includes(nameKey(n)) && seen.push(nameKey(n))).map(displayName);
      } else if (!Array.isArray(t.who)) t.who = [];
    });
    rememberPeople(list.flatMap((t) => t.who));
    return list;
  }
  const rosterNames = () => (cfg.people || []).slice().sort((a, b) => nameKey(a).localeCompare(nameKey(b)));
  const chipsHtml = (who) => (who && who.length
    ? `<span class="whos">${who.slice(0, 3).map((n) => `<span class="who-chip" style="--p:${personColor(n)}">${esc(n)}</span>`).join('')}${who.length > 3 ? `<span class="who-chip more">+${who.length - 3}</span>` : ''}</span>`
    : '');

  // ─── To-do list ────────────────────────────────────────────────────────────

  const byPosition = (a, b) => ((a.position || '') < (b.position || '') ? -1 : (a.position || '') > (b.position || '') ? 1 : 0);
  const completedMs = (t) => Date.parse(t.completed) || 0;

  // Open items in list order; checked-off items from the last 24 hours, newest first.
  function taskGroups() {
    const now = Date.now();
    return {
      open: state.tasks.filter((t) => !t.done).sort(byPosition),
      done: state.tasks.filter((t) => t.done && now - completedMs(t) < DONE_KEEP_MS).sort((a, b) => completedMs(b) - completedMs(a)),
    };
  }
  function ago(ms) {
    const m = Math.max(1, Math.round((Date.now() - ms) / 60000));
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
  }

  function renderTasks() {
    const { open, done } = taskGroups();
    $('taskCount').textContent = open.length || '';
    let html = '';
    if (!open.length) html += `<li class="task task-empty">${Icons.check}All caught up</li>`;
    html += open.map((t) => `
      <li class="task${t.pending ? ' pending' : ''}" data-id="${esc(t.id)}">
        <span class="box">${Icons.check}</span><span class="body"><span class="label">${esc(t.title)}</span>${chipsHtml(t.who)}</span>
      </li>`).join('');
    if (done.length) {
      html += '<li class="task-rule">Done · last 24h</li>';
      html += done.map((t) => `
        <li class="task done" data-id="${esc(t.id)}">
          <span class="box">${Icons.check}</span><span class="body"><span class="label">${esc(t.title)}</span>${chipsHtml(t.who)}</span><span class="ago">${ago(completedMs(t))}</span>
        </li>`).join('');
    }
    $('tasks').innerHTML = html;
  }

  async function mutate(fn) {
    state.mutating++;
    try { return await fn(); } finally { state.mutating--; state.lastMutation = Date.now(); }
  }
  const persistDemo = () => demoTasks.save(state.tasks);

  function completeTask(t) {
    if (t.done || t.pending) return;
    t.done = true;
    t.completed = new Date().toISOString();
    renderTasks();
    showToast(`Done: ${t.title}`, 'Undo', () => restoreTask(t));
    if (isDemo()) return persistDemo();
    mutate(() => backend.setDone(t.id, true)).catch(() => {
      t.done = false; t.completed = null; renderTasks();
      showToast('Couldn’t save — check your connection');
    });
  }

  function restoreTask(t) {
    if (!t.done) return;
    t.done = false;
    t.completed = null;
    renderTasks();
    if (isDemo()) return persistDemo();
    mutate(() => backend.setDone(t.id, false)).catch(() => {
      showToast('Couldn’t undo — check your connection');
    });
  }

  function addTasks(text, who = []) {
    const titles = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    titles.reverse().forEach((title) => {
      const tmp = { id: 'tmp-' + Math.random().toString(36).slice(2), title, who, done: false, pending: !isDemo() };
      state.tasks.unshift(tmp);
      if (isDemo()) return;
      mutate(() => backend.addTask(title, who))
        .then((task) => { Object.assign(tmp, task, { pending: false, who }); renderTasks(); })
        .catch(() => {
          state.tasks = state.tasks.filter((x) => x !== tmp);
          renderTasks();
          showToast(`Couldn’t add “${title}” — check your connection`);
        });
    });
    if (isDemo()) persistDemo();
    renderTasks();
  }

  // Tap the check box to check an item off; tap anywhere else on it for its details.
  const taskSheet = $('taskSheet');
  const tkWho = whoPicker({ pills: $('tkPills'), box: $('tkNew'), input: $('tkInput'), addBtn: $('tkAdd') });
  let openTaskId = null, taskTimer = null;

  function openTask(t) {
    openTaskId = t.id;
    $('tkTitle').textContent = t.title;
    tkWho.reset(t.who || []);
    const rest = parseNotes(t.notes || '').rest.trim();
    $('tkNotes').innerHTML = rest ? `<div class="ev-row"><b>Notes</b><div>${esc(rest)}</div></div>` : '';
    $('tkDone').textContent = t.done ? 'Restore' : 'Mark done';
    if (!taskSheet.open) taskSheet.showModal();
    clearTimeout(taskTimer);
    taskTimer = setTimeout(() => { if (taskSheet.open) taskSheet.close(); }, 90000);
  }
  const openedTask = () => state.tasks.find((x) => x.id === openTaskId);

  function saveWho(t, who) {
    const prev = { who: t.who, notes: t.notes };
    const notes = buildNotes(who, parseNotes(t.notes || '').rest);
    t.who = who; t.notes = notes;
    renderTasks();
    if (isDemo()) return persistDemo();
    mutate(() => backend.setNotes(t.id, notes)).catch(() => {
      t.who = prev.who; t.notes = prev.notes; renderTasks();
      showToast('Couldn’t save — check your connection');
    });
  }

  $('tasks').addEventListener('click', (e) => {
    const li = e.target.closest('.task[data-id]');
    const t = li && state.tasks.find((x) => x.id === li.dataset.id);
    if (!t) return;
    if (e.target.closest('.box')) { if (t.done) restoreTask(t); else completeTask(t); return; }
    if (t.pending) { showToast('Still saving that one…'); return; }
    openTask(t);
  });
  $('tkSave').addEventListener('click', () => {
    tkWho.commit();
    const t = openedTask();
    if (t) {
      const now = tkWho.names(), before = (t.who || []).map(nameKey).sort().join('|');
      if (now.map(nameKey).sort().join('|') !== before) saveWho(t, now);
    }
    taskSheet.close();
  });
  $('tkCancel').addEventListener('click', () => taskSheet.close());
  $('tkDone').addEventListener('click', () => {
    const t = openedTask();
    taskSheet.close();
    if (!t) return;
    if (t.done) restoreTask(t); else completeTask(t);
  });
  taskSheet.addEventListener('click', (e) => { if (e.target === taskSheet) taskSheet.close(); });
  taskSheet.addEventListener('close', () => { clearTimeout(taskTimer); openTaskId = null; });

  // Add sheet
  const addSheet = $('addSheet');
  // The "Who?" picker, used by both the Add dialog and the item details dialog.
  function whoPicker({ pills, box, input, addBtn }) {
    let selected = new Map();   // key → display name
    let edit = false;
    const picker = {
      reset(names = []) {
        selected = new Map(names.map((n) => [nameKey(n), n]));
        edit = false; box.hidden = true; input.value = '';
        picker.render();
      },
      names: () => Array.from(selected.values()).sort((a, b) => nameKey(a).localeCompare(nameKey(b))),
      render() {
        const known = new Map(rosterNames().map((n) => [nameKey(n), n]));
        selected.forEach((n, k) => { if (!known.has(k)) known.set(k, n); });   // someone on the task but not in this device's list
        const all = Array.from(known.values()).sort((a, b) => nameKey(a).localeCompare(nameKey(b)));
        pills.innerHTML =
          `<button type="button" class="who-pill${selected.size ? '' : ' on'}" data-anyone="1">Anyone</button>` +
          all.map((n) => `<button type="button" class="who-pill${selected.has(nameKey(n)) ? ' on' : ''}" data-who="${esc(n)}" style="--p:${personColor(n)}"><i></i>${esc(n)}${edit ? '<b>×</b>' : ''}</button>`).join('') +
          '<button type="button" class="who-pill ghost" data-act="new">+ Someone</button>' +
          (all.length ? `<button type="button" class="who-pill ghost" data-act="edit">${edit ? 'Done' : 'Edit'}</button>` : '');
      },
      // Take whatever name is typed in the box (even if "Add person" wasn't tapped). True if there was one.
      commit() {
        const name = input.value.replace(/[@\s]+/g, ' ').trim();
        if (!name) return false;
        const shown = displayName(name);
        rememberPeople([shown]);
        selected.set(nameKey(name), shown);
        input.value = ''; box.hidden = true;
        picker.render();
        return true;
      },
    };
    pills.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.anyone) selected.clear();
      else if (b.dataset.act === 'new') { box.hidden = false; input.focus(); return; }
      else if (b.dataset.act === 'edit') edit = !edit;
      else if (b.dataset.who) {
        const k = nameKey(b.dataset.who);
        if (edit) { cfg.people = (cfg.people || []).filter((n) => nameKey(n) !== k); selected.delete(k); saveSettings(); }
        else if (selected.has(k)) selected.delete(k); else selected.set(k, b.dataset.who);
      }
      picker.render();
    });
    addBtn.addEventListener('click', () => picker.commit());
    // Some keyboards don't report "Enter" as a normal key, so also catch the key code.
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); picker.commit(); } });
    return picker;
  }
  const addWho = whoPicker({ pills: $('whoPills'), box: $('whoNew'), input: $('whoInput'), addBtn: $('whoAdd') });

  $('addBtn').addEventListener('click', () => {
    $('addInput').value = '';
    addWho.reset();
    addSheet.showModal();
    setTimeout(() => $('addInput').focus(), 50);
  });
  $('addCancel').addEventListener('click', () => addSheet.close());
  $('addForm').addEventListener('submit', (e) => {
    // The keyboard's Enter key inside the "new person" box submits this form: treat it as "add person".
    if (document.activeElement === $('whoInput')) { e.preventDefault(); addWho.commit(); return; }
    addWho.commit();                       // a name typed but not confirmed still counts
    const v = $('addInput').value.trim();
    if (!v) { e.preventDefault(); return; }
    addTasks(v, addWho.names());
  });
  addSheet.addEventListener('click', (e) => { if (e.target === addSheet) addSheet.close(); });

  // Voice input: the Android app uses the system recognizer; Chrome uses its own.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const capFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  if (NATIVE && NATIVE.startVoice) {
    window.skreenVoice = (text) => { if (text) { $('addInput').value = capFirst(text); $('addInput').focus(); } };
    $('micBtn').addEventListener('click', () => NATIVE.startVoice());
  } else if (!SR) {
    $('micBtn').hidden = true;
  } else {
    let rec = null;
    $('micBtn').addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.onresult = (e) => { $('addInput').value = capFirst(Array.from(e.results).map((r) => r[0].transcript).join('')); };
      rec.onend = () => { rec = null; $('micBtn').classList.remove('listening'); };
      rec.onerror = rec.onend;
      $('micBtn').classList.add('listening');
      rec.start();
    });
  }

  // ─── Weather (Open-Meteo, no key needed) ───────────────────────────────────

  const isWet = (code) => code >= 51;

  async function refreshWeather() {
    if (cfg.lat == null) return;
    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.search = new URLSearchParams({
      latitude: cfg.lat, longitude: cfg.lon,
      current: 'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m',
      hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
      temperature_unit: cfg.units,
      wind_speed_unit: cfg.units === 'fahrenheit' ? 'mph' : 'kmh',
      timezone: 'auto',
      forecast_days: 6,
    });
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.weather = await res.json();
      renderWeather();
    } catch (err) { console.warn('Weather failed', err); }
  }

  function renderWeather() {
    const w = state.weather;
    if (!w) return;
    const c = w.current, d = w.daily, h = w.hourly;
    const now = Icons.weather(c.weather_code, c.is_day);
    $('wxPlace').textContent = cfg.place || '';
    $('wxIcon').innerHTML = now.svg;
    $('wxTemp').textContent = Math.round(c.temperature_2m) + '°';
    $('wxCond').textContent = now.label;
    $('wxSub').innerHTML = `H ${Math.round(d.temperature_2m_max[0])}° · L ${Math.round(d.temperature_2m_min[0])}°<br>Feels ${Math.round(c.apparent_temperature)}°`;
    $('wxSummary').innerHTML = weatherSummary(w);

    const i0 = h.time.findIndex((t) => new Date(t).getTime() > Date.now());
    $('wxHours').innerHTML = i0 < 0 ? '' : h.time.slice(i0, i0 + 6).map((t, j) => {
      const i = i0 + j, info = Icons.weather(h.weather_code[i], h.is_day ? h.is_day[i] : 1), pop = h.precipitation_probability[i];
      return `<div class="wx-hour"><span class="h">${esc(shortHour(new Date(t)))}</span>${info.svg}<span class="t">${Math.round(h.temperature_2m[i])}°</span><span class="pop">${pop >= 30 ? pop + '%' : ''}</span></div>`;
    }).join('');

    $('wxDays').innerHTML = d.time.slice(1, 6).map((t, i) => {
      const k = i + 1, info = Icons.weather(d.weather_code[k]), pop = d.precipitation_probability_max[k];
      return `<div class="wx-day"><span class="d">${esc(fmtDate(parseDate(t), { weekday: 'short' }))}</span>${info.svg}
        <span><span class="hi">${Math.round(d.temperature_2m_max[k])}°</span><span class="lo">${Math.round(d.temperature_2m_min[k])}°</span></span>
        <span class="pop">${pop >= 30 ? pop + '%' : ''}</span></div>`;
    }).join('');
  }

  // Plain-English rain outlook for the next 12 hours; returns {icon, text}.
  function rainOutlook(w) {
    const h = w.hourly, nowMs = Date.now();
    const i0 = h.time.findIndex((t) => new Date(t).getTime() > nowMs - 3600000);
    if (i0 < 0) return null;
    const hours = [];
    for (let i = i0; i < Math.min(i0 + 12, h.time.length); i++) hours.push({ t: new Date(h.time[i]), pop: h.precipitation_probability[i] ?? 0, code: h.weather_code[i] });
    const wet = (x) => isWet(x.code) || x.pop >= 55;
    const kind = (code) => (code >= 95 ? 'Storms' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'Snow' : 'Rain');

    if (isWet({ code: w.current.weather_code, pop: 0 })) {
      const stop = hours.findIndex((x) => !wet(x)), k = kind(w.current.weather_code);
      return { wet: true, text: stop > 0 ? `${k} easing around ${shortHour(hours[stop].t)}` : `${k} continuing for a while` };
    }
    const first = hours.find(wet);
    if (first) return { wet: true, text: `${kind(first.code)} likely around ${shortHour(first.t)} (${first.pop}%)` };
    return { wet: false, text: `No rain expected ${new Date(nowMs).getHours() >= 15 ? 'tonight' : 'today'}` };
  }
  function weatherSummary(w) {
    const r = rainOutlook(w);
    return r ? `${r.wet ? Icons.umbrella : Icons.check}${esc(r.text)}` : '';
  }

  // ─── Backgrounds ───────────────────────────────────────────────────────────

  function currentBackground() {
    if (cfg.bg !== 'auto' && Backgrounds.byId(cfg.bg)) return Backgrounds.byId(cfg.bg);
    return Backgrounds.forDay(new Date());
  }

  function applyBackground() {
    const art = currentBackground();
    if (art.id === state.bgKey) return;
    state.bgKey = art.id;
    document.body.dataset.bg = art.id;
    $('bgArt').style.background = art.css;
  }

  // ─── Big-screen tour (burn-in protection) ──────────────────────────────────

  const TOUR = ['time', 'weather', 'agenda', 'todo'];
  const tour = { on: false, i: 0, cycle: 0, timer: null, last: Date.now() };

  function maybeStartTour(now = new Date()) {
    const mins = Number(cfg.showcaseMinutes);
    if (!mins || tour.on || refresh.on || isNight(now) || dialogOpen()) return;
    if (now.getTime() - tour.last >= mins * 60000) startTour();
  }
  const dialogOpen = () => !!document.querySelector('dialog[open]') || !$('guide').hidden;

  function startTour() {
    tour.on = true; tour.i = 0; tour.cycle++;
    const box = $('showcase');
    box.hidden = false;
    const bar = $('showBar');
    bar.style.transition = 'none'; bar.style.width = '0';
    void bar.offsetWidth;
    bar.style.transition = `width ${TOUR.length * TOUR_VIEW_MS}ms linear`; bar.style.width = '100%';
    showTourView();
  }

  function showTourView() {
    const body = $('showBody'), prev = body.firstElementChild;
    if (prev) { prev.classList.add('out'); setTimeout(() => prev.remove(), 600); }
    const name = TOUR[tour.i];
    const v = document.createElement('div');
    v.className = `sv sv-${name} p${(tour.cycle + tour.i) % 3}`;
    v.innerHTML = tourHtml(name);
    body.appendChild(v);
    tour.timer = setTimeout(() => { tour.i++; if (tour.i >= TOUR.length) endTour(); else showTourView(); }, TOUR_VIEW_MS);
  }

  function endTour() {
    clearTimeout(tour.timer);
    tour.on = false; tour.last = Date.now();
    $('showcase').hidden = true;
    $('showBody').innerHTML = '';
  }
  $('showcase').addEventListener('click', endTour);

  function tourHtml(name) {
    const now = new Date();
    if (name === 'time') {
      const { hm, ap } = timeParts(now);
      return `<div class="kicker">Time</div><div class="big">${clockHtml(hm)}${ap ? `<small>${ap}</small>` : ''}</div><div class="bigdate">${esc(fmtDate(now, { weekday: 'long', month: 'long', day: 'numeric' }))}</div>`;
    }
    if (name === 'weather') {
      const w = state.weather;
      if (!w) return '<div class="kicker">Weather</div><div class="cond">Loading…</div>';
      const c = w.current, d = w.daily, info = Icons.weather(c.weather_code, c.is_day), r = rainOutlook(w);
      return `${info.svg}<div class="col2"><div class="kicker">Weather · ${esc(cfg.place || '')}</div>
        <div class="bigtemp">${Math.round(c.temperature_2m)}°</div><div class="cond">${esc(info.label)}</div>
        <div class="hl">H ${Math.round(d.temperature_2m_max[0])}° · L ${Math.round(d.temperature_2m_min[0])}° · Feels ${Math.round(c.apparent_temperature)}°</div>
        ${r ? `<div class="rain">${r.wet ? Icons.umbrella : Icons.check}${esc(r.text)}</div>` : ''}</div>`;
    }
    if (name === 'agenda') {
      const events = state.events.map(normalizeEvent).filter((e) => e.e > now).sort((a, b) => (a.allDay === b.allDay ? a.s - b.s : a.allDay ? -1 : 1));
      const today = startOfDay(now), tomorrow = addDays(today, 1), after = addDays(today, 2);
      const soon = events.filter((e) => e.s < after).slice(0, 4);
      let rows = soon.map((e) => {
        const running = !e.allDay && e.s <= now;
        const when = e.allDay ? 'All day' : fmtTime(e.s, { small: true });
        const day = e.s >= tomorrow && !e.allDay ? 'Tomorrow · ' : '';
        return `<div class="row${running ? ' now' : ''}"><div class="rt">${when}</div><div class="rn">${esc(e.title)}<small>${esc(day)}${esc(e.location ? e.location.split('\n')[0] : e.calendar || '')}</small></div></div>`;
      }).join('');
      if (!rows) rows = '<div class="empty-big">Nothing on the calendar</div>';
      return `<div class="kicker">Next up</div><div class="sv-list">${rows}</div>`;
    }
    const { open } = taskGroups();
    const rows = open.slice(0, 6).map((t) => `<div class="row"><div class="bullet"></div><div class="rn">${esc(t.title)}${t.who && t.who.length ? `<span class="sv-who">${t.who.map(esc).join(' · ')}</span>` : ''}</div></div>`).join('')
      || '<div class="empty-big">All caught up</div>';
    return `<div class="kicker">To-do · ${open.length}</div><div class="sv-list">${rows}${open.length > 6 ? `<div class="more">+ ${open.length - 6} more</div>` : ''}</div>`;
  }

  // ─── Night mode ────────────────────────────────────────────────────────────

  const minutesOf = (hhmm) => { const [h, m] = (hhmm || '0:0').split(':').map(Number); return h * 60 + m; };
  function isNight(now = new Date()) {
    if (cfg.nightEnabled !== '1') return false;
    const m = now.getHours() * 60 + now.getMinutes(), s = minutesOf(cfg.nightStart), e = minutesOf(cfg.nightEnd);
    return s <= e ? m >= s && m < e : m >= s || m < e;
  }

  function updateNight(now = new Date()) {
    const night = $('night');
    const on = isNight(now) && Date.now() > state.nightDismissedUntil;
    if (on && tour.on) endTour();
    if (night.hidden === !on) { if (on) renderNight(now); return; }
    night.hidden = !on;
    if (on) renderNight(now);
  }

  function renderNight(now) {
    const { hm, ap } = timeParts(now);
    $('nightTime').innerHTML = `${clockHtml(hm)}${ap ? `<span class="ampm">${ap}</span>` : ''}`;
    $('nightDate').textContent = fmtDate(now, { weekday: 'long', month: 'long', day: 'numeric' });
    const upcoming = state.events.map(normalizeEvent).filter((ev) => !ev.allDay && ev.s > now).sort((a, b) => a.s - b.s)[0];
    if (upcoming) {
      const sameDay = startOfDay(upcoming.s).getTime() === startOfDay(now).getTime();
      const tomorrow = startOfDay(upcoming.s).getTime() === addDays(startOfDay(now), 1).getTime();
      const day = sameDay ? '' : tomorrow ? 'Tomorrow ' : fmtDate(upcoming.s, { weekday: 'long' }) + ' ';
      $('nightNext').innerHTML = `Next: <b>${esc(upcoming.title)}</b> · ${day}${fmtTime(upcoming.s)}`;
    } else $('nightNext').textContent = '';
    // Drift a little so nothing sits in the same spot all night.
    $('nightInner').style.transform = `translate(${(Math.sin(now.getMinutes() / 9) * 4).toFixed(2)}rem, ${(Math.cos(now.getMinutes() / 7) * 4).toFixed(2)}rem)`;
  }

  $('night').addEventListener('click', () => {
    state.nightDismissedUntil = Date.now() + 2 * 60000;
    $('night').hidden = true;
    setTimeout(() => updateNight(), 2 * 60000 + 500);
  });

  // ─── Status line ───────────────────────────────────────────────────────────

  function renderStatus() {
    const el = $('status');
    el.className = 'status';
    el.hidden = false;
    // Most urgent first: a running update, then sign-in/connection trouble, then an available
    // update, then the "sample data" nudge.
    if (state.updating) {
      const u = state.updating;
      el.dataset.go = 'none';
      el.innerHTML = `<span class="dot"></span>${u.ready ? 'Update downloaded. Confirm the install on screen' : `Downloading update${u.pct ? ` · ${u.pct}%` : '…'}`}`;
    } else if (!isDemo() && state.syncError === 'auth') {
      el.classList.add('error');
      el.dataset.go = 'signin';
      el.innerHTML = '<span class="dot"></span>Google needs you to sign in again · <u>Sign in</u>';
    } else if (!isDemo() && state.syncError) {
      el.classList.add('error');
      el.dataset.go = 'fix';
      el.innerHTML = `<span class="dot"></span>Can’t reach Google right now${state.lastSync ? ` · last updated ${fmtTime(state.lastSync)}` : ''} · <u>Help</u>`;
    } else if (state.update) {
      el.dataset.go = 'update';
      el.innerHTML = `<span class="dot"></span>Skreen ${esc(state.update.name)} is available · <u>Install update</u>`;
    } else if (isDemo()) {
      el.dataset.go = canSignIn() ? 'signin' : 'start';
      el.innerHTML = canSignIn()
        ? '<span class="dot"></span>Showing sample data · <u>Sign in with Google →</u>'
        : '<span class="dot"></span>Showing sample data · <u>Set up Skreen →</u>';
    } else { el.hidden = true; el.innerHTML = ''; }
  }
  $('status').addEventListener('click', (e) => {
    const go = e.currentTarget.dataset.go;
    if (go === 'signin') { startSignIn(); return; }
    if (go === 'update') { startUpdate(); return; }
    if (go === 'none') return;
    openGuide(go);
  });

  // ─── Toast ─────────────────────────────────────────────────────────────────

  let toastTimer = null;
  function showToast(msg, actionLabel, onAction) {
    const el = $('toast');
    el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
    if (actionLabel) el.querySelector('button').onclick = () => { el.classList.remove('show'); onAction(); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
  }

  // ─── App updates (Android app, sideloaded) ─────────────────────────────────
  // Sideloaded apps don't update themselves, so Skreen checks its own GitHub release.

  const UPDATE_CHECK_MS = 3600 * 1000;       // hourly, and also when the screen wakes after a gap
  let lastUpdateCheck = 0;
  const canUpdate = () => !!(NATIVE && NATIVE.getVersion && NATIVE.installUpdate);

  function releaseRepo() {
    const m = /^([^.]+)\.github\.io$/.exec(location.hostname), repo = location.pathname.split('/')[1];
    return m && repo ? { owner: m[1], repo } : null;
  }

  // Returns {state: 'update' | 'current' | 'unknown', ...}; also updates the banner.
  async function checkForUpdate() {
    if (!canUpdate()) return { state: 'unknown' };
    const r = releaseRepo();
    if (!r) return { state: 'unknown' };
    const res = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('GitHub returned ' + res.status);
    const rel = await res.json();
    const asset = (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
    const build = Number(((rel.body || '').match(/skreen-build:\s*(\d+)/i) || [])[1] || 0);
    const installed = Number(NATIVE.getVersion());
    if (asset && build > installed) {
      const notes = (rel.body || '').split('\n').map((l) => l.trim()).find((l) => l && !/^skreen-build/i.test(l) && !/^sideload/i.test(l)) || '';
      state.update = { build, name: (rel.name || '').replace(/^Skreen\s*/i, '') || String(build), notes, url: asset.browser_download_url, digest: (asset.digest || '').replace(/^sha256:/i, '') };
    } else {
      state.update = null;
    }
    renderStatus();
    return state.update ? { state: 'update', update: state.update } : { state: 'current' };
  }
  const backgroundUpdateCheck = () => { lastUpdateCheck = Date.now(); return checkForUpdate().catch(() => {}); };

  function startUpdate() {
    if (!state.update || state.updating) return;
    state.updating = { pct: 0 };
    renderStatus();
    try { NATIVE.installUpdate(state.update.url, state.update.digest); }
    catch (_) { window.skreenUpdate('error', 'bridge'); }
  }

  // Progress from the native side.
  window.skreenUpdate = (kind, value) => {
    if (kind === 'progress') { state.updating = { pct: Number(value) || 0 }; }
    else if (kind === 'ready') { state.updating = { pct: 100, ready: true }; setTimeout(() => { state.updating = null; renderStatus(); }, 20000); }
    else if (kind === 'permission') {
      state.updating = null;
      showToast('Allow Skreen to install updates, then come back and tap Install update again');
    } else if (kind === 'error') {
      state.updating = null;
      showToast('Couldn’t download the update here', 'Open in browser', () => { try { NATIVE.openExternal(state.update ? state.update.url : ''); } catch (_) {} });
    }
    renderStatus();
    refreshAppSection();
  };

  function refreshAppSection() {
    if (!canUpdate()) return;
    let name = '';
    try { name = NATIVE.getVersionName ? NATIVE.getVersionName() : ''; } catch (_) {}
    $('appVersion').textContent = `Skreen app ${name || 'build ' + NATIVE.getVersion()}`;
    $('installUpdate').hidden = !state.update;
    $('installUpdate').disabled = !!state.updating;
    if (state.update) $('updateResult').textContent = `${state.update.name} is available${state.update.notes ? ': ' + state.update.notes : ''}`;
  }
  $('checkUpdate').addEventListener('click', async () => {
    const out = $('updateResult');
    out.textContent = 'Checking…';
    try {
      const r = await checkForUpdate();
      out.textContent = r.state === 'update' ? `${r.update.name} is available${r.update.notes ? ': ' + r.update.notes : ''}`
        : r.state === 'current' ? 'You’re up to date.' : 'Couldn’t tell which version is newest.';
    } catch (e) { out.textContent = 'Couldn’t reach GitHub. Check your connection.'; }
    refreshAppSection();
  });
  $('installUpdate').addEventListener('click', () => { startUpdate(); settingsSheet.close(); });

  // ─── Google sign-in (Android app) ──────────────────────────────────────────

  async function startSignIn() {
    if (!canSignIn()) { openGuide('start'); return false; }
    try {
      await nativeToken('signIn');
    } catch (e) {
      showToast('Sign-in didn’t finish. Tap to try again from Settings.');
      return false;
    }
    Google.forgetCaches();
    cfg.signedIn = true;
    cfg.welcomed = true;
    saveSettings();
    state.syncError = null;
    if ($('welcome').open) $('welcome').close();
    refreshData();
    return true;
  }

  function signOut() {
    try { NATIVE.signOut(); } catch (_) {}
    Google.forgetCaches();
    cfg.signedIn = false; cfg.calendarIds = []; cfg.taskListId = '';
    saveSettings();
    state.events = []; state.syncError = null;
    refreshData();
  }

  const welcome = $('welcome');
  $('welcomeSignIn').addEventListener('click', () => { startSignIn(); });
  $('welcomeLater').addEventListener('click', () => { cfg.welcomed = true; saveSettings(); welcome.close(); });
  function maybeWelcome() {
    if (canSignIn() && isDemo() && !cfg.welcomed) welcome.showModal();
  }

  // ─── Setup guide ───────────────────────────────────────────────────────────

  const guide = $('guide');
  let guideId = 'start';

  function openGuide(id = 'start') {
    guideId = Guide.sections.some((s) => s.id === id) ? id : 'start';
    guide.hidden = false;
    if (tour.on) endTour();
    renderGuide();
  }
  function closeGuide() { guide.hidden = true; }

  function renderGuide() {
    const sec = Guide.sections.find((s) => s.id === guideId);
    $('guideNav').innerHTML = `<div class="brand">skreen<i>.</i></div><div class="tag">Setup guide</div>` +
      Guide.sections.map((s, i) => `<button type="button" data-go="${s.id}" class="${s.id === guideId ? 'on' : ''}"><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</button>`).join('');
    const body = $('guideBody');
    body.innerHTML = sec.html;
    body.scrollTop = 0;

    const sw = body.querySelector('#swatches');
    if (sw) sw.innerHTML = Backgrounds.list.map((b) => `<div class="sw" style="background:${b.css.replace(/"/g, '&quot;')}"><span>${esc(b.name)}</span></div>`).join('');

    const apk = body.querySelector('[data-apk]');
    if (apk) {
      const m = /^([^.]+)\.github\.io$/.exec(location.hostname), repo = location.pathname.split('/')[1];
      if (m && repo) apk.href = `https://github.com/${m[1]}/${repo}/releases/latest/download/Skreen.apk`;
      else apk.outerHTML = '<p>Open your GitHub repository’s <b>Releases</b> page on the tablet and download <code>Skreen.apk</code>.</p>';
    }

    const url = body.querySelector('#lgUrl'), key = body.querySelector('#lgKey'), base = body.querySelector('#lgBase');
    if (url) {
      url.value = cfg.backendUrl; key.value = cfg.secret;
      base.value = NATIVE ? '' : `${location.origin}${location.pathname}`;
      const build = () => {
        const u = url.value.trim(), k = key.value.trim(), b = base.value.trim();
        body.querySelector('#lgOut').textContent = u && k && /^https?:/.test(b)
          ? `${b}${b.includes('?') ? '&' : '?'}backend=${encodeURIComponent(u)}&key=${encodeURIComponent(k)}`
          : 'Fill in all three boxes to build your link.';
      };
      url.oninput = key.oninput = base.oninput = build; build();
    }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }

  guide.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { guideId = go.dataset.go; renderGuide(); return; }
    if (e.target.closest('[data-open-settings]')) { closeGuide(); openSettings(); return; }
    const status = guide.querySelector('[data-copy-status]');
    if (e.target.closest('[data-copy-script]')) {
      try {
        const res = await fetch('setup/Code.gs', { cache: 'no-cache' });
        if (!res.ok) throw new Error();
        const ok = await copyText(await res.text());
        status.textContent = ok ? 'Copied. Now paste it into the Apps Script editor.' : 'Couldn’t copy automatically — open setup/Code.gs and copy it by hand.';
      } catch (_) { status.textContent = 'Couldn’t load the script. Check your connection.'; }
    }
    if (e.target.closest('[data-copy-link]')) {
      const t = guide.querySelector('#lgOut').textContent;
      if (!/^https?:/.test(t)) return;
      const ok = await copyText(t);
      e.target.closest('button').textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { const b = guide.querySelector('[data-copy-link]'); if (b) b.textContent = 'Copy link'; }, 2000);
    }
  });
  $('guideClose').addEventListener('click', closeGuide);

  // ─── Screen refresh ────────────────────────────────────────────────────────
  // Slowly washes the whole screen through white, red, green, blue and black. Showing every
  // pixel a range of colours for a few minutes helps clear temporary "ghost" images.

  const REFRESH_COLORS = ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000'];
  const refresh = { on: false, timer: null, i: 0, started: 0 };
  function startRefresh() {
    if (refresh.on) return;
    refresh.on = true; refresh.i = 0; refresh.started = Date.now();
    if (tour.on) endTour();
    settingsSheet.close();
    const el = $('refresh');
    el.hidden = false;
    const step = () => {
      el.style.backgroundColor = REFRESH_COLORS[refresh.i % REFRESH_COLORS.length];
      refresh.i++;
      if (Date.now() - refresh.started > 5 * 60000) { stopRefresh(); return; }
      refresh.timer = setTimeout(step, 6000);
    };
    step();
  }
  function stopRefresh() {
    clearTimeout(refresh.timer);
    refresh.on = false;
    $('refresh').hidden = true;
    tour.last = Date.now();
  }
  $('refresh').addEventListener('click', stopRefresh);
  $('refreshBtn').addEventListener('click', startRefresh);

  // ─── Place names ───────────────────────────────────────────────────────────
  // "Current location" is not much use on a wall; say where it actually is.

  const US_STATES = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT',
    'Delaware': 'DE', 'District of Columbia': 'DC', 'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL',
    'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT',
    'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA',
    'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
  };
  function formatPlace({ city, region, country } = {}) {
    if (!city && !region) return null;
    if (!city) return region;
    if (country === 'US' && US_STATES[region]) return `${city}, ${US_STATES[region]}`;
    return region && region !== city ? `${city}, ${region}` : city;
  }

  const pendingPlaces = new Map();
  let placeSeq = 0;
  window.skreenPlace = (id, info) => {
    const done = pendingPlaces.get(id);
    if (done) { pendingPlaces.delete(id); done(info); }
  };

  // Android: the device's own geocoder. Anywhere else: a free reverse-geocoding service.
  async function placeName(lat, lon) {
    if (NATIVE && NATIVE.reverseGeocode) {
      const info = await new Promise((resolve) => {
        const id = ++placeSeq;
        pendingPlaces.set(id, resolve);
        try { NATIVE.reverseGeocode(id, lat, lon); } catch (_) { pendingPlaces.delete(id); resolve(null); }
        setTimeout(() => { if (pendingPlaces.has(id)) { pendingPlaces.delete(id); resolve(null); } }, 8000);
      });
      const name = formatPlace(info || {});
      if (name) return name;
    }
    try {
      const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const j = await res.json();
      return formatPlace({ city: j.city || j.locality, region: j.principalSubdivision, country: j.countryCode });
    } catch (_) { return null; }
  }

  // Replace the generic label with the real place name once we have it.
  async function nameCurrentLocation() {
    if (cfg.place !== 'Current location' || cfg.lat == null) return;
    const name = await placeName(cfg.lat, cfg.lon);
    if (!name || cfg.place !== 'Current location') return;
    cfg.place = name;
    saveSettings();
    $('wxPlace').textContent = name;
  }

  // ─── Settings sheet ────────────────────────────────────────────────────────

  const settingsSheet = $('settingsSheet'), form = $('settingsForm');
  let draftLoc = null;

  function fillBackgroundOptions() {
    $('bgSelect').innerHTML =
      '<option value="auto">Surprise me (changes daily)</option>' +
      Backgrounds.list.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  }

  // Night-mode times as plain dropdowns (15-minute steps). The system time picker is cramped
  // and can't be styled, so Skreen uses its own.
  function fillTimeOptions() {
    for (const sel of settingsSheet.querySelectorAll('select.timesel')) {
      const cur = cfg[sel.name];
      const slots = [];
      for (let m = 0; m < 24 * 60; m += 15) slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      if (cur && !slots.includes(cur)) { slots.push(cur); slots.sort(); }
      sel.innerHTML = slots.map((v) => {
        const [h, m] = v.split(':').map(Number);
        return `<option value="${v}">${esc(fmtTime(new Date(2000, 0, 1, h, m)))}</option>`;
      }).join('');
    }
  }
  $('fontSelect').addEventListener('change', (e) => applyFont(e.target.value));   // live preview
  settingsSheet.addEventListener('close', () => applyFont(cfg.font));              // Cancel puts it back

  function openSettings() {
    fillBackgroundOptions();
    fillTimeOptions();
    for (const el of form.elements) if (el.name && el.name in cfg) el.value = cfg[el.name] ?? '';
    draftLoc = cfg.lat != null ? { lat: cfg.lat, lon: cfg.lon, place: cfg.place } : null;
    $('locCurrent').textContent = draftLoc ? `✓ ${draftLoc.place}` : 'No location set';
    $('locResults').innerHTML = '';
    $('testResult').textContent = '';
    settingsSheet.showModal();
    fillGoogleSection();
    refreshAppSection();
  }

  // Android app: show the account, the calendars to choose from, and the to-do list.
  let calChoices = null, listChoice = null;
  async function fillGoogleSection() {
    calChoices = null; listChoice = null;
    if (!canSignIn()) return;
    const status = $('acctStatus'), calList = $('calList'), listSel = $('listSelect');
    $('signInBtn').hidden = usingGoogle();
    $('signOutBtn').hidden = !usingGoogle();
    $('calBox').hidden = $('listBox').hidden = !usingGoogle();
    if (!usingGoogle()) { status.textContent = 'Not signed in. Showing sample data.'; return; }
    let who = '';
    try { who = NATIVE.getAccount ? NATIVE.getAccount() : ''; } catch (_) {}
    status.textContent = who ? `Signed in as ${who}` : 'Signed in';
    calList.textContent = 'Loading…'; listSel.innerHTML = '';
    try {
      const [cals, lists] = await Promise.all([Google.listCalendars(true), Google.listTaskLists()]);
      const chosen = new Set(Google.chosenCalendars(cals, cfg.calendarIds).map((c) => c.id));
      calChoices = cals;
      calList.innerHTML = cals.map((c, i) => `<label class="check"><input type="checkbox" data-i="${i}" ${chosen.has(c.id) ? 'checked' : ''}><i style="background:${esc(c.color)}"></i><span>${esc(c.name)}</span></label>`).join('');
      const cur = cfg.taskListId || (lists.find((l) => l.title.toLowerCase() === 'household') || {}).id || '';
      listChoice = lists;
      listSel.innerHTML = lists.map((l) => `<option value="${esc(l.id)}" ${l.id === cur ? 'selected' : ''}>${esc(l.title)}</option>`).join('');
    } catch (e) {
      calList.textContent = 'Couldn’t load your calendars. Check your connection.';
    }
  }
  $('signInBtn').addEventListener('click', async () => { if (await startSignIn()) fillGoogleSection(); });
  $('signOutBtn').addEventListener('click', () => { signOut(); fillGoogleSection(); });
  $('gearBtn').addEventListener('click', openSettings);
  $('settingsCancel').addEventListener('click', () => settingsSheet.close());
  $('openGuide').addEventListener('click', () => { settingsSheet.close(); openGuide('start'); });

  function setDraftLoc(loc) {
    draftLoc = loc;
    $('locCurrent').textContent = `✓ ${loc.place}`;
    $('locResults').innerHTML = '';
  }

  $('locFind').addEventListener('click', async () => {
    const q = $('locSearch').value.trim();
    if (!q) return;
    $('locResults').textContent = 'Searching…';
    try {
      const { results = [] } = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name=${encodeURIComponent(q)}`)).json();
      if (!results.length) { $('locResults').textContent = 'No matches.'; return; }
      $('locResults').innerHTML = '';
      results.forEach((r) => {
        const place = [r.name, r.admin1, r.country_code].filter(Boolean).join(', ');
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = place;
        b.onclick = () => setDraftLoc({ lat: r.latitude, lon: r.longitude, place });
        $('locResults').appendChild(b);
      });
    } catch (_) { $('locResults').textContent = 'Search failed.'; }
  });
  $('locSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('locFind').click(); } });

  $('locGps').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    $('locCurrent').textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = +p.coords.latitude.toFixed(3), lon = +p.coords.longitude.toFixed(3);
        setDraftLoc({ lat, lon, place: 'Current location' });
        $('locCurrent').textContent = '✓ Finding the place name…';
        const name = await placeName(lat, lon);
        if (name && draftLoc && draftLoc.lat === lat) setDraftLoc({ lat, lon, place: name });
      },
      () => { $('locCurrent').textContent = 'Couldn’t get your location — try searching instead.'; },
      { timeout: 15000 }
    );
  });

  $('settingsTest').addEventListener('click', async () => {
    const out = $('testResult'), url = form.elements.backendUrl.value.trim();
    if (!url) { out.textContent = 'Enter the backend URL first.'; return; }
    out.textContent = 'Testing…';
    const saved = { ...cfg };
    cfg.backendUrl = url; cfg.secret = form.elements.secret.value.trim();
    try {
      const d = await api('dashboard');
      out.textContent = `✓ Connected — ${d.events.length} events, ${d.tasks.filter((t) => !t.done).length} to-dos`;
    } catch (err) {
      out.textContent = `✗ ${err.message === 'unauthorized' ? 'Secret key doesn’t match' : err.message}`;
    } finally { cfg = saved; }
  });

  form.addEventListener('submit', () => {
    for (const el of form.elements) if (el.name && el.name in cfg) cfg[el.name] = el.value.trim();
    if (draftLoc) Object.assign(cfg, draftLoc);
    if (calChoices) {
      cfg.calendarIds = Array.from($('calList').querySelectorAll('input:checked')).map((el) => calChoices[+el.dataset.i].id);
      if (!cfg.calendarIds.length) cfg.calendarIds = calChoices.filter((c) => c.primary).map((c) => c.id);
    }
    if (listChoice && $('listSelect').value) cfg.taskListId = $('listSelect').value;
    Google.forgetCaches();
    saveSettings();
    state.nightDismissedUntil = 0;
    state.bgKey = '';
    tour.last = Date.now();
    lastMinute = -1;
    nudgeLayout(new Date());
    applyBrightness();
    refreshData();
    refreshWeather();
  });

  // ─── Demo data (shown until a backend is connected) ────────────────────────

  function demoEvents() {
    const t = startOfDay(new Date());
    const at = (day, h, m = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + day, h, m).toISOString();
    const ymd = (day) => { const d = addDays(t, day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const now = new Date();
    const soon = new Date(Math.ceil((now.getTime() + 30 * 60000) / 900000) * 900000);
    const C = { family: '#5fbf8f', mom: '#9aa5ff', dad: '#4fb3ff', kids: '#ff7a59', home: '#f2c94c' };
    return [
      { title: 'Recycling pickup', allDay: true, start: ymd(0), end: ymd(1), color: C.home },
      { title: 'School drop-off', start: at(0, 8, 0), end: at(0, 8, 30), color: C.kids, calendar: 'Kids' },
      { title: 'Grocery delivery window', start: new Date(now - 25 * 60000).toISOString(), end: new Date(+now + 35 * 60000).toISOString(), color: C.home, calendar: 'Home' },
      { title: 'Dentist — Dr. Patel', start: soon.toISOString(), end: new Date(+soon + 3600000).toISOString(), location: '220 Main St, Suite 4', color: C.mom },
      { title: 'Soccer practice', start: at(0, 17, 30), end: at(0, 18, 45), location: 'Riverside Park, Field 3', color: C.kids },
      { title: 'Dinner with the Hendersons', start: at(0, 19, 30), end: at(0, 21, 30), color: C.family, calendar: 'Family' },
      { title: 'Plumber visit', start: at(1, 9, 0), end: at(1, 11, 0), color: C.home, calendar: 'Home' },
      { title: 'Parent–teacher conference', start: at(1, 16, 15), end: at(1, 16, 45), location: 'Lincoln Elementary', color: C.dad },
      { title: 'Grandma’s birthday', allDay: true, start: ymd(2), end: ymd(3), color: C.family },
      { title: 'Farmers market', start: at(2, 10, 0), end: at(2, 11, 30), color: C.family, calendar: 'Family' },
      { title: 'Piano lesson', start: at(3, 15, 30), end: at(3, 16, 15), color: C.kids, calendar: 'Kids' },
    ];
  }

  const demoTasks = {
    key: 'skreen-demo-tasks',
    initial() {
      const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
      return [
        ...['Paper towels', 'Oat milk', 'Call HVAC about the filter', 'Return library books', 'Replace smoke detector battery', 'Book haircuts']
          .map((title, i) => ({ id: 'demo-' + i, title, done: false, position: String(i).padStart(5, '0'), who: [[], ['Dan'], ['Mia'], [], ['Dan', 'Mia'], []][i] })),
        { id: 'demo-d1', title: 'Take out the recycling', done: true, completed: ago(2) },
        { id: 'demo-d2', title: 'Order dog food', done: true, completed: ago(19) },
      ];
    },
    load() {
      try { const saved = JSON.parse(localStorage.getItem(this.key)); if (Array.isArray(saved)) return saved; } catch (_) {}
      return this.initial();
    },
    save(tasks) { try { localStorage.setItem(this.key, JSON.stringify(tasks.filter((t) => !t.pending))); } catch (_) {} },
  };

  // ─── Keep the screen awake & offline support ───────────────────────────────

  async function keepAwake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      keepAwake(); refreshData(); refreshWeather();
      if (canUpdate() && Date.now() - lastUpdateCheck > 15 * 60000) backgroundUpdateCheck();
    }
  });

  // Android back button: close whatever is open, never leave the app.
  window.skreenBack = () => {
    if (refresh.on) { stopRefresh(); return true; }
    if (tour.on) { endTour(); return true; }
    if (!guide.hidden) { closeGuide(); return true; }
    const open = document.querySelector('dialog[open]');
    if (open) { open.close(); return true; }
    return false;
  };

  // ─── Boot ──────────────────────────────────────────────────────────────────

  function boot() {
    if (cfg.lat == null) {
      // Until a location is chosen, try the device's location, then fall back to New York.
      Object.assign(cfg, { lat: 40.713, lon: -74.006, place: 'New York, NY' });
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((p) => {
          Object.assign(cfg, { lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), place: 'Current location' });
          saveSettings();
          refreshWeather();
          nameCurrentLocation();
        }, () => {}, { timeout: 15000 });
      }
    }
    tick();
    refreshData();
    refreshWeather();
    nameCurrentLocation();     // also fixes up a location saved earlier as "Current location"
    keepAwake();
    applyBrightness();
    maybeWelcome();
    if (canUpdate()) { setTimeout(backgroundUpdateCheck, 20000); setInterval(backgroundUpdateCheck, UPDATE_CHECK_MS); }
    if (!canSignIn()) { $('advanced').open = true; $('advanced').querySelector('summary').textContent = 'Google connection'; }
    setInterval(refreshData, REFRESH_DATA_MS);
    setInterval(refreshWeather, REFRESH_WEATHER_MS);
    if ('serviceWorker' in navigator && location.protocol === 'https:' && location.hostname !== 'appassets.androidplatform.net') navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  boot();
})();
