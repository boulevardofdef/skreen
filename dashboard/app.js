/* Skreen — wall display for calendar, to-dos, weather and backgrounds. */
(() => {
  'use strict';

  // ─── Settings (stored on this device) ──────────────────────────────────────

  const DEFAULTS = {
    lat: null, lon: null, place: '',
    units: 'fahrenheit', clock: '12',
    bg: 'auto', font: 'bricolage', accent: 'orange',
    showcaseMinutes: '5', refreshMinutes: '10', bigMode: '0', slideSeconds: '60', slideSkip: '', pixelShift: '1',
    layout: 'clock,weather,agenda,todo', photoSource: 'art', photoSeconds: '30', mealList: '', shopList: '', pageSeconds: '60',
    ics: [],
    nightEnabled: '1', nightStart: '22:30', nightEnd: '06:00',
    dayBrightness: 'system', nightBrightness: '3',
    signedIn: false, calSel: {}, listSel: {}, addTo: '', welcomed: false,
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
  if (cfg.showcaseMinutes === 'always') { cfg.showcaseMinutes = '5'; cfg.bigMode = '1'; saveSettings(); }   // the old "always on" tour is now Big Skreen Mode
  if (cfg.people || 'backendUrl' in cfg || 'secret' in cfg) { delete cfg.people; delete cfg.backendUrl; delete cfg.secret; saveSettings(); }   // names now come from the tasks themselves; the script backend is gone
  // Where the data comes from: Google sign-in in the app, or sample data.
  const canSignIn = () => !!(window.SkreenNative && window.SkreenNative.signIn);
  const usingGoogle = () => canSignIn() && !!cfg.signedIn;
  const noSource = () => !usingGoogle() && !(cfg.ics && cfg.ics.length);
  // Nothing is connected yet: show an empty skeleton, never made-up data. (Add ?test=yes, or ?demo, to the address to see sample data, for testing and screenshots.)
  const DEV_DEMO = (() => { const q = new URLSearchParams(location.search); return q.has('demo') || q.get('test') === 'yes'; })();
  const isDemo = () => DEV_DEMO && noSource();


  const REFRESH_WEATHER_MS = 15 * 60 * 1000;
  const AGENDA_DAYS = 7;
  const DAY_MS = 86400000;
  const DONE_KEEP_MS = DAY_MS;          // checked-off items stay for 24 hours
  const TOUR_VIEW_MS = 7500;            // 4 views ≈ 30 seconds

  // Present only inside the Skreen Android app.
  const NATIVE = window.SkreenNative || null;
  if (NATIVE) document.body.classList.add('native');
  try { if (NATIVE && NATIVE.isStoreBuild && NATIVE.isStoreBuild()) document.body.classList.add('store'); } catch (_) {}   // Play build: Google Play does the updating

  const $ = (id) => document.getElementById(id);
  const clockHtml = (hm) => hm.replace(':', '<span class="colon">:</span>');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const FONTS = ['bricolage', 'fraunces', 'archivo', 'space', 'shoulders'];
  const applyFont = (f) => { document.body.dataset.font = FONTS.includes(f) ? f : 'bricolage'; };
  applyFont(cfg.font);

  // The accent is the one bright colour on the screen (the "now" event, weather icon, timers). Everything draws it from --accent.
  const ACCENTS = { orange: '#ff5b2e', amber: '#ffb020', mint: '#3ddc97', sky: '#4cc3ff', blue: '#7b93ff', violet: '#b58cff', rose: '#ff6fae', red: '#ff4d4d' };
  const applyAccent = (id) => {
    const c = ACCENTS[id] || ACCENTS.orange, n = parseInt(c.slice(1), 16);
    const mix = (v) => Math.round(v + (255 - v) * 0.4);   // a lighter shade for the alarm's pulse
    const root = document.documentElement.style;
    root.setProperty('--accent', c);
    root.setProperty('--accent-soft', `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`);
  };
  applyAccent(cfg.accent);

  // Static icons
  $('addIcon').innerHTML = Icons.plus;
  $('gearBtn').innerHTML = Icons.gear;
  $('micBtn').innerHTML = Icons.mic;
  $('locGps').innerHTML = Icons.pin;
  $('guideArrow').innerHTML = Icons.arrow;
  $('guideClose').innerHTML = Icons.close;

  // ─── State ─────────────────────────────────────────────────────────────────

  const state = {
    events: [], tasks: [], lists: [], weather: null, loaded: false,
    lastSync: null, syncError: null,
    mutating: 0, lastMutation: 0,
    nightDismissedUntil: 0,
    bgKey: '',
    update: null, updating: null,
  };

  // ─── Google ────────────────────────────────────────────────────────────────

  // Android app: ask the native side for a Google access token.
  const pendingTokens = new Map();
  let tokenSeq = 0;
  window.skreenToken = (id, token, err) => {
    const p = pendingTokens.get(id);
    if (!p) return;
    pendingTokens.delete(id);
    if (token) p.resolve(token); else p.reject(new Error(err || 'no token'));
  };
  const nativeToken = (method, arg) => new Promise((resolve, reject) => {
    const id = ++tokenSeq;
    pendingTokens.set(id, { resolve, reject });
    try { if (arg === undefined) NATIVE[method](id); else NATIVE[method](id, arg); } catch (e) { pendingTokens.delete(id); reject(e); }
    setTimeout(() => { if (pendingTokens.has(id)) { pendingTokens.delete(id); reject(new Error('timed out')); } }, method === 'signIn' ? 300000 : 30000);
  });
  if (NATIVE && NATIVE.getToken) Google.init((acct) => (NATIVE.getTokenFor && acct ? nativeToken('getTokenFor', acct) : nativeToken('getToken')), (acct) => { if (NATIVE.clearToken) NATIVE.clearToken(acct || ''); });

  // ─── Accounts, calendars and lists (several accounts and lists are Skreen+) ─

  // (An older app build only knows one account: getAccount.)
  const accountList = () => {
    try {
      if (!NATIVE) return [];
      if (NATIVE.getAccounts) return JSON.parse(NATIVE.getAccounts());
      const one = NATIVE.getAccount ? NATIVE.getAccount() : '';
      return one ? [one] : [];
    } catch (_) { return []; }
  };
  const activeAccounts = () => { const all = accountList(); return hasPlus() ? all : all.slice(0, 1); };

  // Older versions kept one flat list of calendar ids and one list id; move them under the first account.
  (function migrateSelections() {
    const first = accountList()[0];
    if (!first || (!(cfg.calendarIds || []).length && !cfg.taskListId)) { if ('calendarIds' in cfg || 'taskListId' in cfg) { delete cfg.calendarIds; delete cfg.taskListId; saveSettings(); } return; }
    cfg.calSel = cfg.calSel || {}; cfg.listSel = cfg.listSel || {};
    if ((cfg.calendarIds || []).length) cfg.calSel[first] = cfg.calendarIds;
    if (cfg.taskListId) cfg.listSel[first] = [cfg.taskListId];
    delete cfg.calendarIds; delete cfg.taskListId;
    saveSettings();
  })();

  // Which task lists are shown: per account, the ticked ones (just one without Skreen+), else Google's default.
  async function listsFor(acct) {
    let ids = (cfg.listSel && cfg.listSel[acct]) || [];
    if (!hasPlus()) ids = ids.slice(0, 1);
    return ids.length ? ids : [await Google.resolveList(acct, '')];
  }
  const listNameCache = new Map();   // account → { at, names }
  async function listNames(acct) {
    const hit = listNameCache.get(acct);
    if (hit && Date.now() - hit.at < 10 * 60000) return hit.names;
    const names = {};
    for (const l of await Google.listTaskLists(acct)) names[l.id] = l.title;
    listNameCache.set(acct, { at: Date.now(), names });
    return names;
  }
  const taskKey = (a, l, id) => `${a}|${l}|${id}`;
  const withRef = (t, a, l, name) => ({ ...t, rid: t.id, id: taskKey(a, l, t.id), a, l, ln: name || '' });

  // One interface, whichever source is in use.
  const backend = {
    async dashboard() {
      const other = Ics.events(cfg.ics, AGENDA_DAYS);   // never throws; one bad link just shows nothing
      if (!usingGoogle()) return { events: await other, tasks: [], lists: [], errors: [] };
      const perAccount = await Promise.allSettled(activeAccounts().map(async (a) => {
        const calIds = (cfg.calSel && cfg.calSel[a]) || [];
        const listIds = await listsFor(a);
        const names = await listNames(a).catch(() => ({}));
        const [events, ...taskSets] = await Promise.all([
          Google.events(a, calIds, AGENDA_DAYS),
          ...listIds.map((l) => Google.tasks(a, l)),
        ]);
        const lists = listIds.map((l) => ({ a, l, name: names[l] || '' }));
        const tasks = taskSets.flatMap((set, k) => set.map((t) => withRef(t, a, listIds[k], lists[k].name)));
        return { events, tasks, lists };
      }));
      const ok = perAccount.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      const errors = perAccount.filter((r) => r.status === 'rejected').map((r) => r.reason);
      if (!ok.length && errors.length) throw errors[0];
      // The same event can sit on several accounts' calendars; show it once.
      const seen = new Set(), events = [];
      for (const ev of ok.flatMap((r) => r.events)) {
        const k = (ev.uid || ev.id) + '|' + ev.start;
        if (!seen.has(k)) { seen.add(k); events.push(ev); }
      }
      const lists = ok.flatMap((r) => r.lists);
      const tasks = ok.flatMap((r) => r.tasks);
      if (lists.length > 1) tasks.forEach((t) => { t.tag = t.ln; });   // say which list each item is on
      return { events: events.concat(await other), tasks, lists, errors };
    },
    // New items go to the chosen list, else the first one shown.
    addTarget() {
      const lists = state.lists || [];
      return lists.find((x) => `${x.a}|${x.l}` === cfg.addTo) || lists[0] || null;
    },
    async addTask(title, who = []) {
      const dest = this.addTarget();
      if (!dest) throw new Error('no list');
      const t = await Google.addTask(dest.a, dest.l, title, buildNotes(who));
      return { ...withRef(t, dest.a, dest.l, dest.name), tag: (state.lists || []).length > 1 ? dest.name : '' };
    },
    setNotes: (t, notes) => Google.setNotes(t.a, t.l, t.rid, notes),
    setTitle: (t, title) => Google.setTitle(t.a, t.l, t.rid, title),
    setDone: (t, done) => Google.setDone(t.a, t.l, t.rid, done),
  };

  // How often to ask Google for changes is a setting (default 10 minutes). Nothing is asked at night, or when
  // neither the schedule nor the to-do list is on the screen, so the calls (which Google counts and limits) go to
  // times someone can see the result.
  let dataTimer = null, quotaUntil = 0;
  function pollData() {
    if (Date.now() < quotaUntil) return;   // Google asked us to slow down
    const nothingShown = !['agenda', 'todo'].some((w) => visibleWidgets().includes(w));
    const asleep = isNight() && !$('night').hidden;
    if (nothingShown || asleep) return;
    refreshData();
  }
  function scheduleData() {
    clearTimeout(dataTimer);
    dataTimer = setTimeout(() => { pollData(); scheduleData(); }, Math.max(1, Number(cfg.refreshMinutes) || 10) * 60000);
  }

  async function refreshData() {
    if (isDemo()) {
      state.events = demoEvents();
      state.tasks = decorateTasks(demoTasks.load());
      state.lastSync = new Date();
      state.loaded = true;
      renderAll();
      return;
    }
    if (noSource()) {
      state.events = []; state.tasks = []; state.lists = []; state.loaded = false;
      renderAll();
      return;
    }
    try {
      const data = await backend.dashboard();
      state.events = data.events;
      state.lists = data.lists;
      // Don't clobber the list while a tap is still being saved.
      if (!state.mutating && Date.now() - state.lastMutation > 4000) state.tasks = decorateTasks(data.tasks);
      state.lastSync = new Date();
      state.loaded = true;
      const firstErr = (data.errors || [])[0];
      if (firstErr instanceof Google.QuotaError) quotaUntil = Date.now() + 30 * 60000;
      state.syncError = firstErr ? (firstErr instanceof Google.AuthError ? 'auth' : firstErr instanceof Google.QuotaError ? 'quota' : 'partial') : null;
    } catch (err) {
      if (err instanceof Google.QuotaError) quotaUntil = Date.now() + 30 * 60000;   // back off for half an hour; the data on screen stays
      state.syncError = err instanceof Google.AuthError ? 'auth' : err instanceof Google.QuotaError ? 'quota' : (err.message || String(err));
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
      if (mealsShown()) { drawMeals(); if (now.getHours() === 0 && now.getMinutes() === 5) refreshMeals(); }
      applyBackground();       // new day → new background
      updateNight(now);
      updateShowNow();
      nudgeLayout(now);
      applyBrightness(now);
      maybeSelfReload();
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
    const targets = [$('dash'), $('gearBtn'), $('timerBtn'), $('musicBtn'), $('timerBar'), $('status')];
    if (cfg.pixelShift !== '1') { targets.forEach((el) => { el.style.transform = ''; }); return; }
    const m = Math.floor(now.getTime() / 60000);
    const t = `translate(${Math.round(Math.sin(m / 11) * 7)}px, ${Math.round(Math.cos(m / 13) * 5)}px)`;
    targets.forEach((el) => { el.style.transform = t; });
  }


  // ─── Skeletons: grey placeholders while data loads, or until something is connected ───

  // Signed out, or Google took the permission away and nothing has loaded: both show the still placeholders with a sign-in button, not a shimmer that never ends.
  const needsSignIn = () => !isDemo() && canSignIn() && (noSource() || (state.syncError === 'auth' && !state.loaded));
  const skeletonOn = () => !isDemo() && (noSource() || needsSignIn() || !state.loaded);
  const sk = (w, h = 1) => `<i class="sk" style="width:${w}%;height:${h}rem"></i>`;
  function skeletonAgenda() {
    const card = (a, b, c) => `<div class="sk-card"><div class="sk-when">${sk(80, 1.2)}${sk(55, 0.9)}</div><div class="sk-what">${sk(a, 1.3)}${sk(b, 1.3)}${sk(c, 0.9)}</div></div>`;
    const still = noSource() || needsSignIn();
    const cta = still ? `<button type="button" class="sk-cta">${canSignIn() ? 'Sign in with Google to see your day' : 'Add a calendar link in Settings to see your day'}</button>` : '';
    return `<div class="skeleton${still ? ' still' : ''}" aria-hidden="${still ? 'false' : 'true'}">${cta}<div class="sk-day">${sk(30, 1)}</div>${card(78, 52, 40)}${card(66, 0, 34)}${card(84, 60, 44)}${card(58, 0, 30)}</div>`;
  }
  function skeletonTasks() {
    const row = (w) => `<li class="sk-task"><i class="sk sk-box"></i>${sk(w, 1.3)}</li>`;
    const still = noSource() || needsSignIn();
    const cta = still && canSignIn() ? '<li><button type="button" class="sk-cta">Sign in to see your to-do list</button></li>' : '';
    return `<li class="skeleton${still ? ' still' : ''}" aria-hidden="${still ? 'false' : 'true'}"><ul>${cta}${[72, 54, 80, 46, 64].map(row).join('')}</ul></li>`;
  }
  const syncWeatherSkeleton = () => $('weather').classList.toggle('is-loading', !state.weather);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sk-cta')) return;
    if (canSignIn()) startSignIn(); else openSettings();
  });

  // ─── Agenda ────────────────────────────────────────────────────────────────

  const normalizeEvent = (e) => (e.allDay ? { ...e, s: parseDate(e.start), e: parseDate(e.end) } : { ...e, s: new Date(e.start), e: new Date(e.end) });

  const evKey = (ev) => `${ev.id}|${ev.start}`;
  let agendaIndex = new Map();

  function renderAgenda() {
    const el = $('agenda');
    if (skeletonOn()) { agendaIndex = new Map(); el.innerHTML = skeletonAgenda(); delete el.dataset.html; return; }
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
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }   // untouched when nothing changed, so it can't flicker
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
  // Escape text, and turn web addresses into links (opened outside the app).
  function linkify(text) {
    return esc(text).replace(/https?:\/\/[^\s<>"']+/g, (u) => {
      const m = u.match(/[.,;:!?)\]]+$/);
      const tail = m ? m[0] : '';
      const url = tail ? u.slice(0, -tail.length) : u;
      return `<a href="${url}" data-ext>${url}</a>${tail}`;
    });
  }
  function openLink(e) {
    const link = e.target.closest('a[data-ext]');
    if (!link) return;
    e.preventDefault();
    const url = link.getAttribute('href').replace(/&amp;/g, '&');
    if (NATIVE && NATIVE.openExternal && url.startsWith('https://')) NATIVE.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  }
  document.addEventListener('click', openLink);

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
    if (ev.location) rows.push(['Where', linkify(ev.location)]);
    if (ev.meet && ev.meet !== ev.location) rows.push(['Video', linkify(ev.meet)]);
    const cal = ev.calendarName || ev.calendar;
    if (cal) rows.push(['Calendar', `<i></i>${esc(cal)}`]);
    const notes = plainText(ev.description);
    if (notes) rows.push(['Notes', linkify(notes)]);

    eventSheet.style.setProperty('--c', ev.color || 'var(--accent)');
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

  // Who is "in the household" right now: everyone named on a task we can see (open, or done in the
  // last 24 hours), plus anyone just typed into a dialog that is still open. Nothing is stored.
  const sessionNames = new Map();   // key → display, cleared whenever a dialog opens
  function knownPeople() {
    const known = new Map();
    state.tasks.forEach((t) => (t.who || []).forEach((n) => { if (!known.has(nameKey(n))) known.set(nameKey(n), n); }));
    sessionNames.forEach((n, k) => { if (!known.has(k)) known.set(k, n); });
    return known;
  }
  const displayName = (raw) => knownPeople().get(nameKey(raw)) || (raw.charAt(0).toUpperCase() + raw.slice(1));
  function decorateTasks(list) {
    // first pass: tidy names as written; second pass: use the first spelling seen for each person
    const spelled = new Map();
    list.forEach((t) => {
      if (typeof t.notes === 'string') {
        const seen = [];
        t.who = parseNotes(t.notes).who.filter((n) => !seen.includes(nameKey(n)) && seen.push(nameKey(n)));
      } else if (!Array.isArray(t.who)) t.who = [];
      t.who.forEach((n) => { if (!spelled.has(nameKey(n))) spelled.set(nameKey(n), n.charAt(0).toUpperCase() + n.slice(1)); });
    });
    list.forEach((t) => { t.who = t.who.map((n) => spelled.get(nameKey(n)) || n); });
    return list;
  }
  const rosterNames = () => Array.from(knownPeople().values()).sort((a, b) => nameKey(a).localeCompare(nameKey(b)));
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
    if (skeletonOn()) { $('taskCount').textContent = ''; $('tasks').innerHTML = skeletonTasks(); delete $('tasks').dataset.html; return; }
    const { open, done } = taskGroups();
    $('taskCount').textContent = open.length || '';
    let html = '';
    if (!usingGoogle() && !isDemo()) html += `<li class="task task-empty">Sign in with Google to show a to-do list here.</li>`;
    else if (!open.length) html += `<li class="task task-empty">${Icons.check}All caught up</li>`;
    html += open.map((t) => `
      <li class="task${t.pending ? ' pending' : ''}" data-id="${esc(t.id)}">
        <span class="box">${Icons.check}</span><span class="body"><span class="label">${esc(t.title)}</span>${chipsHtml(t.who)}${t.tag ? `<span class="list-tag">${esc(t.tag)}</span>` : ''}</span>
      </li>`).join('');
    if (done.length) {
      html += '<li class="task-rule">Done · last 24h</li>';
      html += done.map((t) => `
        <li class="task done" data-id="${esc(t.id)}">
          <span class="box">${Icons.check}</span><span class="body"><span class="label">${esc(t.title)}</span>${chipsHtml(t.who)}</span><span class="ago">${ago(completedMs(t))}</span>
        </li>`).join('');
    }
    if ($('tasks').dataset.html !== html) { $('tasks').innerHTML = html; $('tasks').dataset.html = html; }
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
    mutate(() => backend.setDone(t, true)).catch(() => {
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
    mutate(() => backend.setDone(t, false)).catch(() => {
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
    $('tkTitle').value = t.title;
    tkWho.reset(t.who || []);
    const rest = parseNotes(t.notes || '').rest.trim();
    $('tkNotes').innerHTML = rest ? `<div class="ev-row"><b>Notes</b><div>${linkify(rest)}</div></div>` : '';
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
    mutate(() => backend.setNotes(t, notes)).catch(() => {
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
  function saveTitle(t, title) {
    const prev = t.title;
    t.title = title;
    renderTasks();
    if (isDemo()) return persistDemo();
    mutate(() => backend.setTitle(t, title)).catch(() => {
      t.title = prev; renderTasks();
      showToast('Couldn’t save — check your connection');
    });
  }

  $('tkSave').addEventListener('click', () => {
    tkWho.commit();
    const t = openedTask();
    if (t) {
      const title = $('tkTitle').value.trim();
      if (title && title !== t.title) saveTitle(t, title);
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
    const picker = {
      reset(names = []) {
        sessionNames.clear();
        selected = new Map(names.map((n) => [nameKey(n), n]));
        box.hidden = true; input.value = '';
        picker.render();
      },
      names: () => Array.from(selected.values()).sort((a, b) => nameKey(a).localeCompare(nameKey(b))),
      render() {
        const known = knownPeople();
        selected.forEach((n, k) => { if (!known.has(k)) known.set(k, n); });
        const all = Array.from(known.values()).sort((a, b) => nameKey(a).localeCompare(nameKey(b)));
        pills.innerHTML =
          `<button type="button" class="who-pill${selected.size ? '' : ' on'}" data-anyone="1">Anyone</button>` +
          all.map((n) => `<button type="button" class="who-pill${selected.has(nameKey(n)) ? ' on' : ''}" data-who="${esc(n)}" style="--p:${personColor(n)}"><i></i>${esc(n)}</button>`).join('') +
          '<button type="button" class="who-pill ghost" data-act="new">+ Someone</button>';
      },
      // Take whatever name is typed in the box (even if "Add person" wasn't tapped). True if there was one.
      commit() {
        const name = input.value.replace(/[@\s]+/g, ' ').trim();
        if (!name) return false;
        const shown = displayName(name);
        sessionNames.set(nameKey(name), shown);
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
      else if (b.dataset.who) {
        const k = nameKey(b.dataset.who);
        if (selected.has(k)) selected.delete(k); else selected.set(k, b.dataset.who);
      }
      picker.render();
    });
    addBtn.addEventListener('click', () => picker.commit());
    // Some keyboards don't report "Enter" as a normal key, so also catch the key code.
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); picker.commit(); } });
    return picker;
  }
  const addWho = whoPicker({ pills: $('whoPills'), box: $('whoNew'), input: $('whoInput'), addBtn: $('whoAdd') });

  $('addToSel').addEventListener('change', (e) => { cfg.addTo = e.target.value; saveSettings(); });
  $('addBtn').addEventListener('click', () => {
    if (!usingGoogle() && !isDemo()) { showToast('Sign in with Google to use the to-do list'); return; }
    $('addInput').value = '';
    addWho.reset();
    const lists = state.lists || [];
    $('addToRow').hidden = lists.length < 2;
    if (lists.length > 1) {
      const dest = backend.addTarget();
      const several = new Set(lists.map((x) => x.a)).size > 1;
      $('addToSel').innerHTML = lists.map((x) => `<option value="${esc(x.a + '|' + x.l)}" ${dest && dest.a === x.a && dest.l === x.l ? 'selected' : ''}>${esc(x.name || 'List')}${several ? ' \u00b7 ' + esc(x.a) : ''}</option>`).join('');
    }
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
  let voiceSink = null;   // who asked: the timer sheet sets this, otherwise the Add box gets the words
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const capFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  if (NATIVE && NATIVE.startVoice) {
    window.skreenVoice = (text) => {
      if (voiceSink) { const f = voiceSink; voiceSink = null; if (text) f(text); return; }
      if (text) { $('addInput').value = capFirst(text); $('addInput').focus(); }
    };
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

  // ─── Weather (providers live in weather.js) ────────────────────────────────

  const isWet = (code) => code >= 51;

  async function refreshWeather() {
    if (cfg.lat == null) return;
    try {
      state.weather = await Weather.forecast(cfg.lat, cfg.lon, cfg.units);
      renderWeather();
    } catch (err) { console.warn('Weather failed', err); }
  }

  function renderWeather() {
    const w = state.weather;
    syncWeatherSkeleton();
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


  // ─── Timers (free) ──────────────────────────────────────────────────────────
  // Up to four named countdowns. They are stored as absolute end times, so they carry on through a
  // reload or restart. When one finishes a full-screen alarm appears over everything (night mode and
  // the slideshow included) and the app plays the tablet's alarm sound until you stop it.

  const TIMER_KEY = 'skreen-timers', MAX_TIMERS = 4;
  let timers = [];
  try { timers = JSON.parse(localStorage.getItem(TIMER_KEY) || '[]').filter((t) => t && t.end && t.end > Date.now() - 10 * 60000); }   // one that finished long ago, while the app was off, is forgotten
  catch (_) { timers = []; }
  const saveTimers = () => { try { localStorage.setItem(TIMER_KEY, JSON.stringify(timers)); } catch (_) {} };
  const alarm = { on: false, soundTimer: null };
  let timerTick = null, timerDigits = '';

  const fmtClock = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  };

  // Sound: the Android app plays the tablet's alarm tone; elsewhere a web-audio beep (unlocked by the
  // tap that started the timer).
  let audioCtx = null;
  const unlockAudio = () => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {}
  };
  document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  function beep() {
    if (!audioCtx) return;
    [0, 0.22, 0.44].forEach((d) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + d;
      o.type = 'square'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.18);
    });
  }
  function startSound() {
    stopSound();
    if (NATIVE && NATIVE.playAlarm) { try { NATIVE.playAlarm(); } catch (_) {} } else { beep(); alarm.soundTimer = setInterval(beep, 1500); }
    alarm.stopAt = setTimeout(stopSound, 3 * 60000);   // never ring all night; the screen stays red until you stop it
  }
  function stopSound() {
    clearInterval(alarm.soundTimer); clearTimeout(alarm.stopAt);
    if (NATIVE && NATIVE.stopAlarm) { try { NATIVE.stopAlarm(); } catch (_) {} }
  }

  function ringing() { return timers.filter((t) => t.end <= Date.now()); }

  // Timers sit under the date in the clock area, so nothing else on the screen moves. When the clock
  // isn't on screen (hidden in Layout, the big-screen tour, night mode) they float across the top instead.
  function renderTimers() {
    const bar = $('timerBar'), inline = $('clockTimers'), now = Date.now();
    const night = !$('night').hidden;
    const inClock = !tour.on && !night && visibleWidgets().includes('clock');
    const pills = timers.map((t) => `<button type="button" class="tpill${t.end <= now ? ' ring' : ''}${night ? ' dim' : ''}" data-tid="${esc(t.id)}">${t.label ? `<span>${esc(t.label)}</span>` : ''}<b>${t.end <= now ? 'DONE' : fmtClock(t.end - now)}</b></button>`).join('');
    document.body.classList.toggle('timer-inline', !!(timers.length && inClock));   // makes room: the 5-day forecast steps aside
    inline.classList.toggle('dense', timers.length >= 3);
    inline.hidden = !(timers.length && inClock);
    bar.hidden = !(timers.length && !inClock);
    inline.innerHTML = inClock ? pills : '';
    bar.innerHTML = inClock ? '' : pills;
    if ($('timerSheet').open) renderTimerSheet();
  }

  function timerLoop() {
    clearInterval(timerTick);
    timerTick = null;
    if (!timers.length) { renderTimers(); return; }
    const step = () => {
      const done = ringing();
      if (done.length && !alarm.on) startAlarm();
      if (alarm.on) {
        if (!done.length) closeAlarm(); else $('alarmWhat').textContent = done.map((t) => t.label || fmtClock(t.dur)).join(' · ');
      }
      renderTimers();
    };
    step();
    timerTick = setInterval(step, 1000);
  }

  function startAlarm() {
    alarm.on = true;
    const sheet = $('alarmSheet');
    if (!sheet.open) sheet.showModal();
    startSound();
  }
  function closeAlarm() {
    alarm.on = false;
    stopSound();
    if ($('alarmSheet').open) $('alarmSheet').close();
  }
  $('alarmStop').addEventListener('click', () => {
    timers = timers.filter((t) => t.end > Date.now());
    saveTimers(); closeAlarm(); timerLoop();
  });
  $('alarmMore').addEventListener('click', () => {
    timers.forEach((t) => { if (t.end <= Date.now()) { t.end = Date.now() + 5 * 60000; t.dur = 5 * 60000; } });
    saveTimers(); closeAlarm(); timerLoop();
  });
  $('alarmSheet').addEventListener('cancel', (e) => e.preventDefault());   // Escape/back must not silently drop the alarm

  // "Hey Google, set a timer": the Android app hands the request over here.
  window.skreenSetTimer = (ms, label) => { if (ms > 0) addTimer(ms, label || ''); };
  function addTimer(ms, label) {
    if (timers.length >= MAX_TIMERS) { showToast('That’s the most timers Skreen can run'); return false; }
    timers.push({ id: Math.random().toString(36).slice(2, 8), label: (label || '').trim().slice(0, 20), end: Date.now() + ms, dur: ms });
    saveTimers(); timerLoop();
    return true;
  }

  // The keypad fills in from the right, like a microwave: 1, 0, 0, 0 reads 00:10:00.
  const digitsToMs = (d) => {
    const p = d.padStart(6, '0'), h = +p.slice(0, 2), m = +p.slice(2, 4), s = +p.slice(4, 6);
    return ((h * 60 + m) * 60 + s) * 1000;
  };
  function renderEntry() {
    const p = timerDigits.padStart(6, '0');
    $('timerRead').textContent = `${p.slice(0, 2)}:${p.slice(2, 4)}:${p.slice(4, 6)}`;
    $('timerRead').classList.toggle('set', !!timerDigits);
    $('timerStart').disabled = !digitsToMs(timerDigits);
  }
  function setEntryMs(ms) {
    const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    timerDigits = String(h * 10000 + m * 100 + r).replace(/^0+/, '').slice(-6);
    renderEntry();
  }
  function renderTimerSheet() {
    const now = Date.now();
    $('timerRunning').innerHTML = timers.map((t) => `<div class="trow"><span class="t-name">${esc(t.label || 'Timer')}</span><span class="t-left">${t.end <= now ? 'DONE' : fmtClock(t.end - now)}</span>
      <button type="button" class="btn ghost small" data-more="${esc(t.id)}">+1 min</button><button type="button" class="btn ghost small" data-cancel="${esc(t.id)}">Cancel</button></div>`).join('');
  }
  function openTimerSheet() {
    timerDigits = ''; $('timerLabel').value = '';
    renderEntry(); renderTimerSheet();
    if (!$('timerSheet').open) $('timerSheet').showModal();
  }
  $('timerBtn').innerHTML = Icons.timer;
  $('timerMic').innerHTML = Icons.mic;
  $('timerBtn').addEventListener('click', openTimerSheet);
  [$('timerBar'), $('clockTimers')].forEach((box) => box.addEventListener('click', (e) => { if (e.target.closest('.tpill')) { if (alarm.on) return; openTimerSheet(); } }));
  $('timerClose').addEventListener('click', () => $('timerSheet').close());
  $('timerSheet').addEventListener('click', (e) => { if (e.target === $('timerSheet')) $('timerSheet').close(); });
  $('timerPresets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]');
    if (b) setEntryMs(+b.dataset.min * 60000);
  });
  $('timerPad').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    if (b.dataset.k === 'back') timerDigits = timerDigits.slice(0, -1);
    else timerDigits = (timerDigits + b.dataset.k).replace(/^0+/, '').slice(-6);
    renderEntry();
  });
  $('timerStart').addEventListener('click', () => {
    unlockAudio();
    const ms = digitsToMs(timerDigits);
    if (ms && addTimer(ms, $('timerLabel').value)) $('timerSheet').close();
  });
  $('timerRunning').addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]'), cancel = e.target.closest('[data-cancel]');
    if (more) { const t = timers.find((x) => x.id === more.dataset.more); if (t) { t.end += 60000; t.dur += 60000; saveTimers(); timerLoop(); } }
    if (cancel) { timers = timers.filter((x) => x.id !== cancel.dataset.cancel); saveTimers(); timerLoop(); if (!timers.length) $('timerSheet').close(); }
  });

  // "ten minutes", "1 hour 30 minutes", "an hour and a half", "90 seconds"
  const WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, a: 1, an: 1 };
  function parseSpoken(text) {
    const s = String(text || '').toLowerCase().replace(/-/g, ' ').replace(/\bhalf an hour\b/g, '30 minutes');
    const num = '(\\d+(?:\\.\\d+)?|[a-z]+(?: [a-z]+)?)', unit = '(hours?|hrs?|minutes?|mins?|seconds?|secs?)', half = '(\\s*and a half)?';
    let total = 0;
    for (const m of s.matchAll(new RegExp(`${num}${half}\\s*${unit}${half}`, 'g'))) {
      let n = parseFloat(m[1]);
      if (isNaN(n)) {
        const parts = m[1].split(' ');
        n = parts.length === 2 && WORDS[parts[0]] >= 20 && WORDS[parts[1]] < 10 ? WORDS[parts[0]] + WORDS[parts[1]] : WORDS[parts[parts.length - 1]];
      }
      if (n === undefined || isNaN(n)) continue;
      if (m[2] || m[4]) n += 0.5;
      const u = m[3][0];
      total += n * (u === 'h' ? 3600 : u === 'm' ? 60 : 1) * 1000;
    }
    return Math.round(total);
  }
  function hearTimer(text) {
    const ms = parseSpoken(text);
    if (ms) setEntryMs(ms); else showToast(`Didn’t catch a time in “${text}”`);
  }
  if (NATIVE && NATIVE.startVoice) {
    $('timerMic').addEventListener('click', () => { voiceSink = hearTimer; NATIVE.startVoice(); });
  } else if (!SR) {
    $('timerMic').hidden = true;
  } else {
    let trec = null;
    $('timerMic').addEventListener('click', () => {
      if (trec) { trec.stop(); return; }
      trec = new SR(); trec.lang = navigator.language || 'en-US';
      trec.onresult = (e) => hearTimer(Array.from(e.results).map((r) => r[0].transcript).join(' '));
      trec.onend = () => { trec = null; $('timerMic').classList.remove('listening'); };
      trec.onerror = trec.onend;
      $('timerMic').classList.add('listening');
      trec.start();
    });
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

  // ─── Music: what's playing on the tablet (Android) and internet radio ──────
  // Now playing and the buttons come from Android's media sessions, so they work with Spotify, YouTube
  // Music and any other music app. Radio is searched through the relay and played by Skreen itself.

  const music = { np: null, art: '', artKey: '', audio: null, station: null, results: [], searched: null };
  const hasMediaNative = () => !!(NATIVE && NATIVE.nowPlaying);
  const DEMO_NP = { access: true, active: true, playing: true, title: 'Something Lifted Her Up', artist: 'Parsons/Archer', album: 'Hydrophobia', app: 'Spotify', canPrev: true, canNext: true };

  function readNow() {
    if (!hasMediaNative()) { music.np = isDemo() ? DEMO_NP : null; music.art = isDemo() ? 'demo-cover.jpg' : ''; return; }
    try {
      const np = JSON.parse(NATIVE.nowPlaying());
      if (np.key !== music.artKey) { music.artKey = np.key || ''; music.art = np.key ? (NATIVE.nowPlayingArt() || '') : ''; }
      music.np = np;
    } catch (_) { music.np = null; }
  }
  function updateMusicBtn() {
    $('musicBtn').classList.toggle('on', !!((music.np && music.np.playing && !isDemo()) || music.audio));
  }
  function renderNow() {
    const box = $('musicNow'), np = music.np;
    if (music.audio && music.station && !(np && np.playing)) {   // a radio station is playing in Skreen itself
      $('songSearch').hidden = !(hasMediaNative() && np && np.access && np.active);
      box.innerHTML = `<div class="np"><div class="np-art">${Icons.music}</div><div><div class="np-title">${esc(music.station.name)}</div><div class="np-artist">Internet radio</div><div class="np-controls"><button type="button" class="main" data-radio-stop aria-label="Stop">${Icons.pause}</button></div></div></div>`;
      return;
    }
    $('songSearch').hidden = !(hasMediaNative() && np && np.access && np.active);
    if (!hasMediaNative() && !isDemo()) {
      box.innerHTML = '<div class="np-setup"><p>Skreen can show and control what your music app is playing (Spotify, YouTube Music and others) in its Android app. The radio below works everywhere.</p></div>';
    } else if (!np || !np.access) {
      box.innerHTML = '<div class="np-setup"><p>To show what’s playing, and give you play, pause and skip buttons, Skreen needs Android’s <b>Notification access</b>. Skreen reads no notifications; it only sees the music player.</p><button type="button" class="btn primary small" data-music-access>Allow in Android settings</button></div>';
    } else if (!np.active) {
      box.innerHTML = '<div class="np-setup"><p>Nothing is playing. Start music in your music app (or cast from your phone) and it will show up here with its controls.</p></div>';
    } else {
      box.innerHTML = `<div class="np"><div class="np-art" ${music.art ? `style="background-image:url('${music.art}')"` : ''}>${music.art ? '' : Icons.music}</div>
        <div><div class="np-title">${esc(np.title || 'Playing')}</div><div class="np-artist">${esc(np.artist)}</div><div class="np-app">${esc(np.app)}</div>
        <div class="np-controls"><button type="button" data-media="prev" aria-label="Previous" ${np.canPrev ? '' : 'disabled'}>${Icons.prev}</button><button type="button" class="main" data-media="toggle" aria-label="${np.playing ? 'Pause' : 'Play'}">${np.playing ? Icons.pause : Icons.play}</button><button type="button" data-media="next" aria-label="Next" ${np.canNext ? '' : 'disabled'}>${Icons.next}</button></div></div></div>`;
    }
  }
  function renderRadioPlaying() {
    const box = $('radioPlaying');
    box.hidden = !music.station;
    if (music.station) box.innerHTML = `<b>${esc(music.station.name)}</b><button type="button" class="btn ghost small" data-radio-stop>Stop</button>`;
  }
  function renderRadioList(note) {
    const list = $('radioList');
    if (note) { list.innerHTML = `<div class="radio-note">${esc(note)}</div>`; return; }
    list.innerHTML = music.results.length
      ? music.results.map((r, i) => `<button type="button" class="radio-item" data-station="${i}"><b>${esc(r.name)}</b><span>${esc([r.where, r.tags].filter(Boolean).join(' · '))}</span></button>`).join('')
      : '<div class="radio-note">No stations found. Try another word.</div>';
  }
  async function searchRadio(q) {
    q = String(q || '').trim();
    music.searched = q;
    renderRadioList('Searching…');
    try {
      const res = await fetch(`${Weather.relay}/radio?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (music.searched !== q) return;   // a newer search is under way
      music.results = data.items || [];
      renderRadioList();
    } catch (_) {
      if (music.searched === q) renderRadioList('Couldn’t reach the radio directory. Check your connection.');
    }
  }
  function stopRadio() {
    if (music.audio) { try { music.audio.pause(); music.audio.removeAttribute('src'); music.audio.load(); } catch (_) {} }
    music.audio = null; music.station = null;
    renderRadioPlaying(); renderNow(); updateMusicBtn();
  }
  function playStation(st) {
    stopRadio();
    const a = new Audio(st.url);
    a.onerror = () => { if (music.audio === a) { stopRadio(); showToast('That station won’t play right now'); } };
    music.audio = a; music.station = st;
    renderRadioPlaying(); renderNow(); updateMusicBtn();
    a.play().catch(() => { if (music.audio === a) { stopRadio(); showToast('That station won’t play right now'); } });
  }
  function openMusic() {
    readNow(); renderNow(); renderRadioPlaying(); updateMusicBtn();
    if (!music.results.length) searchRadio(''); else renderRadioList();
    if (!$('musicSheet').open) $('musicSheet').showModal();
  }
  $('musicBtn').innerHTML = Icons.music;
  $('radioMic').innerHTML = Icons.mic;
  $('musicBtn').addEventListener('click', openMusic);
  $('musicClose').addEventListener('click', () => $('musicSheet').close());
  $('musicSheet').addEventListener('click', (e) => { if (e.target === $('musicSheet')) $('musicSheet').close(); });
  $('musicNow').addEventListener('click', (e) => {
    if (e.target.closest('[data-music-access]')) { try { NATIVE.openMediaAccess(); } catch (_) {} return; }
    if (e.target.closest('[data-radio-stop]')) { stopRadio(); renderNow(); return; }
    const b = e.target.closest('[data-media]');
    if (!b || !hasMediaNative()) return;
    try { NATIVE.mediaControl(b.dataset.media); } catch (_) {}
    setTimeout(() => { readNow(); renderNow(); updateMusicBtn(); }, 500);
  });
  $('radioPlaying').addEventListener('click', (e) => { if (e.target.closest('[data-radio-stop]')) stopRadio(); });
  $('radioList').addEventListener('click', (e) => { const b = e.target.closest('[data-station]'); if (b && music.results[+b.dataset.station]) playStation(music.results[+b.dataset.station]); });
  let radioTimer = null;
  // Ask the music app that's already running to search for a song and play it (it plays in the background).
  function songSearch() {
    const q = $('songQ').value.trim();
    if (!q) return;
    let ok = false;
    try { ok = NATIVE.mediaSearch(q); } catch (_) {}
    showToast(ok ? `Asking ${(music.np && music.np.app) || 'your music app'} to play \u201c${q}\u201d\u2026` : 'Start your music app first, then try again');
    if (ok) { $('songQ').value = ''; setTimeout(() => { readNow(); renderNow(); }, 1500); }
  }
  $('songGo').addEventListener('click', songSearch);
  $('songQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); songSearch(); } });
  $('songMic').innerHTML = Icons.mic;
  if (NATIVE && NATIVE.startVoice) $('songMic').addEventListener('click', () => { voiceSink = (text) => { $('songQ').value = text; songSearch(); }; NATIVE.startVoice(); });
  else $('songMic').hidden = true;
  $('radioQ').addEventListener('input', () => { clearTimeout(radioTimer); radioTimer = setTimeout(() => searchRadio($('radioQ').value), 600); });
  $('radioQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(radioTimer); searchRadio($('radioQ').value); } });
  if (NATIVE && NATIVE.startVoice) $('radioMic').addEventListener('click', () => { voiceSink = (text) => { $('radioQ').value = text; searchRadio(text); }; NATIVE.startVoice(); });
  else $('radioMic').hidden = true;
  // The three corner buttons light up the same way while what they open is active.
  function syncCornerButtons() {
    $('timerBtn').classList.toggle('on', timers.length > 0);
    $('gearBtn').classList.toggle('on', $('settingsSheet').open);
  }
  syncCornerButtons();
  ['settingsSheet'].forEach((id) => { $(id).addEventListener('close', syncCornerButtons); $(id).addEventListener('toggle', syncCornerButtons); });
  new MutationObserver(syncCornerButtons).observe($('settingsSheet'), { attributes: true, attributeFilter: ['open'] });
  let musicTick = 0;
  setInterval(() => {
    musicTick++;
    const open = $('musicSheet').open;
    if (!open && musicTick % 5) return;   // every 3 seconds while the panel is open, otherwise every 15
    readNow(); updateMusicBtn();
    if (open) renderNow();
  }, 3000);
  setInterval(syncCornerButtons, 1000);   // timers start and finish from several places

  // ─── Big-screen tour (burn-in protection) ──────────────────────────────────

  const TOUR_ALL = { time: 'clock', weather: 'weather', forecast: 'weather', agenda: 'agenda', todo: 'todo', photos: 'photos', news: 'news', meals: 'meals', shop: 'shop', music: 'music' };
  const SLIDE_NAMES = { time: 'Clock', weather: 'Weather', agenda: 'Schedule', todo: 'To-do list', photos: 'Photos', news: 'In the news', meals: 'Dinners', shop: 'Shopping list', music: 'Music (while playing)' };
  const slideSkipped = (v) => alwaysTour() && String(cfg.slideSkip || '').split(',').includes(v);
  const musicPlaying = () => !!((music.np && music.np.playing) || music.audio);
  const slideMs = () => (alwaysTour() ? Math.max(5, Number(cfg.slideSeconds) || 60) * 1000 : Math.round(4 * TOUR_VIEW_MS / Math.max(1, TOUR.length)));   // the tour always lasts four slides' worth
  let TOUR = Object.keys(TOUR_ALL);
  const ROTATING_TOUR = ['time', 'weather', 'agenda', 'todo'];   // the occasional tour is always these four, so it's always the same length
  // Is this slide switched on, and does it have something to show right now?
  const viewOkBase = (v) => !slideSkipped(v) && (v === 'music' ? (alwaysTour() && musicPlaying()) : visibleWidgets().includes(TOUR_ALL[v])) && (v !== 'photos' || (photosShown() && photo.current)) && (v !== 'news' || (newsShown() && News.current.length)) && (v !== 'meals' || (mealsShown() && mealState.ready && Object.keys(mealState.byDate).length)) && (v !== 'shop' || (shopShown() && shopState.items.length)) && (!['agenda', 'todo'].includes(v) || state.loaded)
  // The forecast slide has no switch of its own: choose Weather and you get both (Big Skreen Mode only), each for the full slide time.
  const viewOk = (v) => (v === 'forecast' ? alwaysTour() && viewOkBase('weather') && !!(state.weather && state.weather.daily) : viewOkBase(v));
  // The occasional tour is always the same length (four slides' worth). If some of the usual four are off, the rest
  // are shown longer; if all four are off, it uses up to four of the other widgets you have on.
  const tourViews = () => {
    const all = Object.keys(TOUR_ALL).filter(viewOk);
    if (alwaysTour()) return all;
    const base = ROTATING_TOUR.filter(viewOk);
    return base.length ? base : all.filter((v) => v !== 'music' && v !== 'forecast').slice(0, 4);
  };
  const tour = { on: false, i: 0, cycle: 0, timer: null, last: Date.now() };

  // Skreen+: the tour can run all the time. A tap ends it for two minutes, then it resumes.
  const alwaysTour = () => cfg.bigMode === '1' && hasPlus();   // Big Skreen Mode

  function maybeStartTour(now = new Date()) {
    const mins = alwaysTour() ? 2 : Number(cfg.showcaseMinutes);
    if (!mins || tour.on || isNight(now) || dialogOpen()) return;
    // Always-on: begin shortly after the app opens (the two-minute wait is only for resuming after a tap).
    if (alwaysTour() && !tour.everStarted && performance.now() > 8000) { startTour(); return; }
    if (now.getTime() - tour.last >= mins * 60000) startTour();
  }
  const dialogOpen = () => !!document.querySelector('dialog[open]') || !$('guide').hidden;
  // After the app (re)loads, Big Skreen Mode starts within seconds, not at some later minute tick or after the
  // two-minute wait. Check every second until it has started once (Skreen+ can take a moment to be confirmed).
  const bigBoot = setInterval(() => {
    if (tour.everStarted || performance.now() > 180000) { clearInterval(bigBoot); return; }
    if (alwaysTour()) maybeStartTour();
  }, 1000);

  function startTour() {
    tour.on = true; tour.everStarted = true; tour.big = alwaysTour();
    $('showcase').classList.toggle('big', tour.big);
    document.body.classList.toggle('big-mode', tour.big);   // the corner buttons stay usable on top of Big Skreen Mode
    $('showcase').hidden = false;
    beginTourCycle();
  }

  function beginTourCycle() {
    TOUR = tourViews();
    if (!TOUR.length) { endTour(); return; }   // nothing to show right now
    tour.i = 0; tour.cycle++;
    const bar = $('showBar');
    bar.style.transition = 'none'; bar.style.width = '0';
    void bar.offsetWidth;
    bar.style.transition = `width ${TOUR.length * slideMs()}ms linear`; bar.style.width = '100%';
    showTourView();
  }

  function showTourView() {
    clearInterval(tour.subTimer);
    const body = $('showBody'), prev = body.firstElementChild;
    if (prev) { prev.classList.add('out'); setTimeout(() => prev.remove(), 600); }
    const name = TOUR[tour.i];
    const v = document.createElement('div');
    // The every-few-minutes tour keeps everything left-aligned; only the always-on slideshow shifts position
    // (left, centre, right) so a big slide doesn't sit on the same pixels all day.
    v.className = `sv sv-${name} p${alwaysTour() ? (tour.cycle + tour.i) % 3 : 0}`;
    v.innerHTML = tourHtml(name);
    body.appendChild(v);
    fitToWidth(v.querySelector('.big'), v.clientWidth * 0.82);   // never wider than the space inside the side margins
    fitRows(v);
    if (alwaysTour()) startSubs(v); else clearInterval(tour.subTimer);
    tour.timer = setTimeout(() => {
      tour.i++;
      if (tour.i < TOUR.length) showTourView();
      else if (alwaysTour() && !isNight(new Date())) beginTourCycle();   // Big Skreen Mode: straight into the next round, even behind a dialog
      else endTour();
    }, slideMs());
    updateShowNow();
  }

  // Always-on slideshow: what's playing sits in the corner of every slide (the timers already do). A radio station
  // or song shows its name; the music slide itself doesn't need the extra strip.
  function updateShowNow() {
    const on = tour.on && alwaysTour();
    // Weather and time stay in the corner of every slide (the big Weather and Clock slides show them already).
    const corner = $('showClock'), view = TOUR[tour.i];
    const wxOn = on && view !== 'weather' && state.weather, clkOn = on && view !== 'time';
    corner.hidden = !(wxOn || clkOn);
    if (!corner.hidden) {
      let html = '';
      if (wxOn) { const c = state.weather.current, info = Icons.weather(c.weather_code, c.is_day); html += `<span class="sc-wx">${info.svg}<b>${Math.round(c.temperature_2m)}°</b></span>`; }
      if (clkOn) { const { hm, ap } = timeParts(new Date()); html += `<span class="sc-time">${hm}${ap ? `<small>${ap}</small>` : ''}</span>`; }
      corner.innerHTML = html;
    }
    // A small player with its controls, while music is on (the Music slide has the big one).
    const el = $('showNow');
    const np = music.np && music.np.active ? music.np : null;
    const player = on && view !== 'music' && (np || music.audio);
    el.hidden = !player;
    if (!player) return;
    const title = np ? (np.title || 'Playing') : music.station.name;
    const sub = np ? [np.artist, np.app].filter(Boolean).join(' · ') : 'Internet radio';
    const art = np && music.art ? `style="background-image:url('${music.art}')"` : '';
    const controls = np
      ? `<span class="sn-controls"><button type="button" data-media="prev" aria-label="Previous" ${np.canPrev ? '' : 'disabled'}>${Icons.prev}</button><button type="button" data-media="toggle" aria-label="${np.playing ? 'Pause' : 'Play'}">${np.playing ? Icons.pause : Icons.play}</button><button type="button" data-media="next" aria-label="Next" ${np.canNext ? '' : 'disabled'}>${Icons.next}</button></span>`
      : `<span class="sn-controls"><button type="button" data-radio-stop aria-label="Stop">${Icons.pause}</button></span>`;
    const key = [title, sub, np && np.playing, !!art].join('|');
    if (el.dataset.key !== key) {   // only redraw when something changed, so a tap isn't lost mid-redraw
      el.dataset.key = key;
      el.innerHTML = `<span class="sn-art" ${art}>${art ? '' : Icons.music}</span><span class="sn-text"><b>${esc(title)}</b><i>${esc(sub)}</i></span>${controls}`;
    }
  }
  $('showNow').addEventListener('click', (e) => {
    e.stopPropagation();   // using the player must not end the slideshow
    if (e.target.closest('[data-radio-stop]')) { stopRadio(); updateShowNow(); return; }
    const b = e.target.closest('[data-media]');
    if (!b) return;
    if (hasMediaNative()) { try { NATIVE.mediaControl(b.dataset.media); } catch (_) {} }
    setTimeout(() => { readNow(); updateShowNow(); }, 500);
  });
  setInterval(() => {
    if (!tour.on) return;
    if (hasMediaNative()) readNow();
    updateShowNow();
    const ph = document.querySelector('#showBody .sv:not(.out) .sv-photo');   // a long photo slide keeps changing pictures
    if (ph && photo.current && !ph.style.backgroundImage.includes(photo.current)) { ph.style.backgroundImage = `url('${photo.current}')`; ph.style.setProperty('--img', `url('${photo.current}')`); }
    const cap = document.querySelector('#showBody .sv:not(.out) .sv-caption');
    if (cap && cap.textContent !== $('photoCaption').textContent) cap.textContent = $('photoCaption').textContent;
  }, 3000);

  // Lists on the big pages show only the rows that fit inside the margins, never one cut off at the edge.
  function fitRows(v) {
    const list = v.querySelector('.sv-list');
    if (!list || list.classList.contains('sv-stage')) return;   // swiping slides size themselves
    const limit = list.getBoundingClientRect().bottom;
    Array.from(list.children).forEach((r) => { if (r.getBoundingClientRect().bottom > limit + 1) r.style.display = 'none'; });
  }

  // Big type is sized from the screen, but some devices draw the font wider than expected.
  // Measure it and shrink to fit rather than trust the maths (also once fonts finish loading).
  function fitToWidth(el, maxPx) {
    if (!el) return;
    const fit = () => {
      el.style.fontSize = '';
      const w = el.scrollWidth;
      if (w > maxPx) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * maxPx / w).toFixed(1) + 'px';
    };
    fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  }

  function endTour() {
    clearTimeout(tour.timer); clearInterval(tour.subTimer);
    tour.on = false; tour.last = tour.big ? 0 : Date.now();   // Big Skreen Mode comes straight back (after a dialog, or the night)
    tour.big = false;
    document.body.classList.remove('big-mode');
    $('showcase').hidden = true;
    $('showBody').innerHTML = '';
  }
  $('showcase').addEventListener('click', () => { if (!tour.big) endTour(); });   // Big Skreen Mode is left only through Settings

  // A big slide that swipes up through several parts, each given an equal share of the slide's time.
  function stageHtml(kicker, panels, kind) {
    return `<div class="kicker">${kicker}</div><div class="sv-list sv-stage ${kind}">${panels.map((p, i) => `<div class="sv-sub ${i ? 'below' : 'cur'}">${p}</div>`).join('')}</div>`;
  }
  const setSub = (el, state) => { el.classList.remove('above', 'cur', 'below'); el.classList.add(state); };
  function startSubs(v) {
    clearInterval(tour.subTimer);
    const stage = v.querySelector('.sv-stage');
    if (!stage) return;
    // Headlines: shrink any that is too long for its box, so it never runs off the screen.
    stage.querySelectorAll('.sv-headline').forEach((el) => {
      let size = parseFloat(getComputedStyle(el).fontSize);
      for (let k = 0; k < 14 && el.scrollHeight > el.clientHeight + 1 && size > 24; k++) { size *= 0.93; el.style.fontSize = size.toFixed(1) + 'px'; }
    });
    const panels = Array.from(stage.children);
    if (panels.length < 2) return;
    let i = 0, steps = 0;
    tour.subTimer = setInterval(() => {
      const cur = panels[i], next = panels[(i + 1) % panels.length];
      next.classList.add('no-anim'); setSub(next, 'below'); void next.offsetWidth; next.classList.remove('no-anim');   // start the next part below, ready to rise
      setSub(cur, 'above'); setSub(next, 'cur');
      i = (i + 1) % panels.length;
      if (++steps >= panels.length - 1) clearInterval(tour.subTimer);
    }, slideMs() / panels.length);
  }

  function tourHtml(name) {
    if (name === 'meals') {
      const rows = mealDays().slice(0, 5).map(({ date, d, i }) => {
        const items = mealState.byDate[date] || [];
        return `<div class="row${i === 0 ? ' now' : ''}"><div class="rt">${esc(i === 0 ? 'Tonight' : fmtDate(d, { weekday: 'short' }))}</div><div class="rn">${items.length ? esc(items.map((m) => m.title).join(' + ')) : '<span class="sv-none">\u2014</span>'}</div></div>`;
      }).join('');
      return `<div class="kicker">Dinner this week</div><div class="sv-list">${rows}</div>`;
    }
    if (name === 'shop') {
      const rows = shopState.items.slice(0, 8).map((t) => `<div class="row"><div class="bullet"></div><div class="rn">${esc(t.title)}</div></div>`).join('');
      return `<div class="kicker">Shopping</div><div class="sv-list sv-news">${rows}</div>`;
    }
    if (name === 'news' && alwaysTour()) {   // Big Skreen Mode: one big headline at a time, swiping up through up to three
      return stageHtml('In the news', News.current.slice(0, 3).map((h) => `<div class="sv-headline"><span>${esc(h.text)}</span></div>`), 'headlines');
    }
    if (name === 'news') {
      const rows = News.current.slice(0, 4).map((s) => `<div class="row"><div class="rn">${esc(s.text)}</div></div>`).join('');
      return `<div class="kicker">In the news</div><div class="sv-list sv-news">${rows}</div>`;
    }
    if (name === 'music') {
      const np = music.np && music.np.playing ? music.np : null;
      const title = np ? (np.title || 'Playing') : (music.station ? music.station.name : 'Playing');
      const sub = np ? [np.artist, np.app].filter(Boolean).join(' \u00b7 ') : 'Internet radio';
      return `<div class="kicker">Now playing</div><div class="sv-musicrow"><div class="np-art big" ${np && music.art ? `style="background-image:url('${music.art}')"` : ''}>${np && music.art ? '' : Icons.music}</div><div class="sv-musictext"><div class="mt">${esc(title)}</div><div class="ma">${esc(sub)}</div></div></div>`;
    }
    if (name === 'photos') return `<div class="sv-photo${photo.items[photo.order[photo.i]] && photo.items[photo.order[photo.i]].art ? ' art' : ''}" style="background-image:url('${photo.current}'); --img:url('${photo.current}')"></div><div class="sv-caption">${esc($('photoCaption').textContent)}</div>`;
    const now = new Date();
    if (name === 'time') {
      const { hm, ap } = timeParts(now);
      return `<div class="kicker">Time</div><div class="big">${clockHtml(hm)}${ap ? `<small>${ap}</small>` : ''}</div><div class="bigdate">${esc(fmtDate(now, { weekday: 'long', month: 'long', day: 'numeric' }))}</div>`;
    }
    if (name === 'forecast') {   // Big Skreen Mode: the days ahead, one big card each
      const w = state.weather, d = w.daily;
      const cards = d.time.slice(1, 6).map((t, i) => {
        const k = i + 1, info = Icons.weather(d.weather_code[k]), pop = d.precipitation_probability_max ? d.precipitation_probability_max[k] : 0;
        return `<div class="fc-day"><div class="fc-d">${esc(i === 0 ? 'Tomorrow' : fmtDate(parseDate(t), { weekday: 'short' }))}</div>${info.svg}<div class="fc-hi">${Math.round(d.temperature_2m_max[k])}°</div><div class="fc-lo">${Math.round(d.temperature_2m_min[k])}°</div><div class="fc-pop">${pop >= 30 ? pop + '%' : '&nbsp;'}</div></div>`;
      }).join('');
      return `<div class="kicker">Forecast · ${esc(cfg.place || '')}</div><div class="fc-days">${cards}</div>`;
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
      const soon = events.filter((e) => e.s < after).slice(0, alwaysTour() ? 6 : 4);   // Big Skreen Mode: three at a time, up to two screens of them
      const rowHtml = (e) => {
        const running = !e.allDay && e.s <= now;
        const when = e.allDay ? 'All day' : fmtTime(e.s, { small: true });
        const sub = [e.s >= tomorrow && !e.allDay ? 'Tomorrow' : '', e.location ? e.location.split('\n')[0] : e.calendar || ''].filter(Boolean).join(' · ');
        return `<div class="row${running ? ' now' : ''}"><div class="rt">${when}</div><div class="rn"><span class="ttl">${esc(e.title)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;
      };
      if (alwaysTour() && soon.length) {
        const pages = [];
        for (let i = 0; i < soon.length; i += 3) pages.push(soon.slice(i, i + 3).map(rowHtml).join(''));
        return stageHtml('Next up', pages, 'agenda');
      }
      let rows = soon.map(rowHtml).join('');
      if (!rows) rows = '<div class="empty-big">Nothing on the calendar</div>';
      return `<div class="kicker">Next up</div><div class="sv-list">${rows}</div>`;
    }
    const { open } = taskGroups();
    const rows = open.slice(0, 6).map((t) => `<div class="row"><div class="bullet"></div><div class="rn"><span class="ttl">${esc(t.title)}</span>${t.who && t.who.length ? `<span class="sv-who">${t.who.map(esc).join(' · ')}</span>` : ''}</div></div>`).join('')
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
    if (on) renderNight(now); else setTimeout(refreshData, 1500);   // morning: fresh data right away
  }

  function renderNight(now) {
    const { hm, ap } = timeParts(now);
    $('nightTime').innerHTML = `${clockHtml(hm)}${ap ? `<span class="ampm">${ap}</span>` : ''}`;
    fitToWidth($('nightTime'), window.innerWidth * 0.9);
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
      el.innerHTML = `<span class="dot"></span>${u.ready ? 'Update downloaded. Confirm the install on skreen' : `Downloading update${u.pct ? ` · ${u.pct}%` : '…'}`}`;
    } else if (!isDemo() && state.syncError === 'auth') {
      el.classList.add('error');
      el.dataset.go = 'signin';
      el.innerHTML = '<span class="dot"></span>Google needs you to sign in again · <u>Sign in</u>';
    } else if (!isDemo() && state.syncError === 'quota') {
      el.dataset.go = 'none';
      el.innerHTML = `<span class="dot"></span>Google is busy. Showing the last update${state.lastSync ? ` from ${fmtTime(state.lastSync)}` : ''}, trying again soon`;
    } else if (!isDemo() && state.syncError === 'partial') {
      el.classList.add('error');
      el.dataset.go = 'fix';
      el.innerHTML = '<span class="dot"></span>One of your Google accounts can’t be reached right now · <u>Help</u>';
    } else if (!isDemo() && state.syncError) {
      el.classList.add('error');
      el.dataset.go = 'fix';
      el.innerHTML = `<span class="dot"></span>Can’t reach Google right now${state.lastSync ? ` · last updated ${fmtTime(state.lastSync)}` : ''} · <u>Help</u>`;
    } else if (state.update) {
      el.dataset.go = 'update';
      el.innerHTML = `<span class="dot"></span>Skreen ${esc(state.update.name)} is available · <u>Install update</u>`;
    } else if (isDemo()) {
      el.innerHTML = '<span class="dot"></span>Sample data (demo)';
      el.dataset.go = 'none';
    } else if (noSource()) {
      el.dataset.go = canSignIn() ? 'signin' : 'start';
      el.innerHTML = canSignIn()
        ? '<span class="dot"></span>Not connected · <u>Sign in with Google →</u>'
        : '<span class="dot"></span>Not connected · <u>Set up Skreen →</u>';
    } else if (!usingGoogle() && canSignIn()) {
      el.dataset.go = 'signin';
      el.innerHTML = '<span class="dot"></span>Showing your calendar links · <u>Sign in with Google for a to-do list →</u>';
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
  const canUpdate = () => !!(NATIVE && NATIVE.getVersion && NATIVE.installUpdate && !(NATIVE.isStoreBuild && NATIVE.isStoreBuild()));

  // The sideload APK is published on this repo's GitHub releases (the site now lives on its own domain).
  const releaseRepo = () => ({ owner: 'boulevardofdef', repo: 'skreen' });

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
    let name = '';
    try { name = NATIVE && NATIVE.getVersionName ? NATIVE.getVersionName() : ''; } catch (_) {}
    $('appVersion').textContent = NATIVE
      ? `Skreen app ${name || 'build ' + (NATIVE.getVersion ? NATIVE.getVersion() : '')} \u00b7 site ${loadedStamp || 'dev'}`
      : `Skreen on the web \u00b7 site ${loadedStamp || 'dev'}`;
    if (!canUpdate()) return;
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

  function removeAccount(acct) {
    try { NATIVE.removeAccount(acct); } catch (_) {}
    Google.forgetCaches();
    if (cfg.calSel) delete cfg.calSel[acct];
    if (cfg.listSel) delete cfg.listSel[acct];
    if (!accountList().length) { try { NATIVE.signOut(); } catch (_) {} cfg.signedIn = false; cfg.addTo = ''; }
    saveSettings();
    state.events = []; state.tasks = []; state.lists = []; state.syncError = null;
    refreshData();
  }

  const welcome = $('welcome');
  $('welcomeSignIn').addEventListener('click', () => { startSignIn(); });
  $('welcomeLater').addEventListener('click', () => { cfg.welcomed = true; saveSettings(); welcome.close(); });
  function maybeWelcome() {
    if (canSignIn() && noSource() && !cfg.welcomed) welcome.showModal();
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
    $('guideNav').innerHTML = `${Icons.logo}<div class="tag">Setup guide</div>` +
      Guide.sections.map((s, i) => `<button type="button" data-go="${s.id}" class="${s.id === guideId ? 'on' : ''}"><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</button>`).join('');
    const body = $('guideBody');
    body.innerHTML = sec.html;
    body.scrollTop = 0;

    const sw = body.querySelector('#swatches');
    if (sw) sw.innerHTML = Backgrounds.list.map((b) => `<div class="sw" style="background:${b.css.replace(/"/g, '&quot;')}"><span>${esc(b.name)}</span></div>`).join('');

    const apk = body.querySelector('[data-apk]');
    if (apk) apk.href = 'https://github.com/boulevardofdef/skreen/releases/latest/download/Skreen.apk';

    body.querySelectorAll('[data-night]').forEach((el) => { el.textContent = nightHoursText(); });
  }

  // "10:30 PM to 6:00 AM", from the night-mode times in Settings.
  function nightHoursText() {
    const t = (v) => { const [h, m] = String(v).split(':').map(Number); return fmtTime(new Date(2000, 0, 1, h || 0, m || 0)); };
    return `${t(cfg.nightStart)} to ${t(cfg.nightEnd)}`;
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
  });
  $('guideClose').addEventListener('click', closeGuide);

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
      const j = await Weather.reverse(lat, lon);
      return formatPlace({ city: j.name, region: j.region, country: j.country });
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


  // ─── Layout (Skreen Plus: show, hide and reorder the widgets) ──────────────
  // cfg.layout is the order, with hidden widgets prefixed "-": "agenda,todo,-weather,clock".
  // Clock and weather sit in one column when they're next to each other.

  const WIDGETS = { clock: 'Clock', weather: 'Weather', agenda: 'Schedule', todo: 'To-do list', photos: 'Photos (Skreen+)', news: 'In the news (Skreen+)', meals: 'Dinners (Skreen+)', shop: 'Shopping list (Skreen+)' };
  const LAYOUT_FR = { pair: 1.06, clock: 1.06, weather: 1.06, agenda: 1.3, todo: 0.92, photos: 1.15, news: 1.1, meals: 1.1, shop: 1 };
  const hasPlus = () => Plus.active();

  function parseLayout(str) {
    const seen = new Set(), out = [];
    for (const raw of String(str || '').split(',')) {
      const off = raw.trim().startsWith('-'), id = raw.trim().replace(/^-/, '');
      if (WIDGETS[id] && !seen.has(id)) { seen.add(id); out.push({ id, on: !off }); }
    }
    for (const id of Object.keys(WIDGETS)) if (!seen.has(id)) out.push({ id, on: !['photos', 'news', 'meals', 'shop'].includes(id) });   // the Plus widgets start hidden
    if (!out.some((w) => w.on)) out.forEach((w) => { w.on = true; });
    return out;
  }
  const serializeLayout = (items) => items.map((w) => (w.on ? '' : '-') + w.id).join(',');
  const activeLayout = () => parseLayout(hasPlus() ? cfg.layout : DEFAULTS.layout);
  const visibleWidgets = () => activeLayout().filter((w) => w.on).map((w) => w.id);

  // ─── Screens: at most three columns on one screen; the rest go on further screens ───

  const MAX_LANES = 3;   // columns per screen; the clock and weather side by side share one
  const phoneLayout = () => matchMedia('(orientation: portrait) and (max-width: 700px)').matches;
  function buildLanes(ids) {
    const lanes = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], next = ids[i + 1];
      const pair = (id === 'clock' && next === 'weather') || (id === 'weather' && next === 'clock');
      lanes.push(pair ? { kind: 'pair', ids: [id, next] } : { kind: id, ids: [id] });
      if (pair) i++;
    }
    return lanes;
  }
  const paginate = (lanes) => {
    if (phoneLayout()) return [lanes];          // a phone scrolls one long screen instead
    const pages = [];
    for (let i = 0; i < lanes.length; i += MAX_LANES) pages.push(lanes.slice(i, i + MAX_LANES));
    return pages.length ? pages : [[]];
  };
  const pager = { index: 0, count: 1, changedAt: Date.now(), dragging: false };

  function applyLayout() {
    const dash = $('dash'), shelf = $('shelf');
    const items = activeLayout();
    const els = {};
    dash.querySelectorAll('[data-w]').forEach((el) => { els[el.dataset.w] = el; });
    dash.querySelectorAll('.pager-view').forEach((p) => p.remove());
    items.filter((w) => !w.on).forEach((w) => shelf.appendChild(els[w.id]));
    const pages = paginate(buildLanes(items.filter((w) => w.on).map((w) => w.id)));
    const track = document.createElement('div');
    track.className = 'pager';
    for (const lanes of pages) {
      const page = document.createElement('div');
      page.className = 'page';
      for (const l of lanes) {
        const lane = document.createElement('div');
        lane.className = 'lane' + (l.kind === 'pair' ? ' pair' : '');
        l.ids.forEach((id) => lane.appendChild(els[id]));
        page.appendChild(lane);
      }
      page.style.setProperty('--cols', lanes.map((l) => `minmax(0, ${LAYOUT_FR[l.kind]}fr)`).join(' '));
      track.appendChild(page);
    }
    const view = document.createElement('div');
    view.className = 'pager-view';
    view.appendChild(track);
    dash.insertBefore(view, shelf);
    pager.count = pages.length;
    pager.index = Math.min(pager.index, pager.count - 1);
    track.style.transition = 'none';
    setPage(pager.index, { instant: true });
    drawDots();
    if (typeof syncPhotos === 'function') syncPhotos();
    if (typeof syncNews === 'function') syncNews();
    if (typeof refreshMeals === 'function') { drawMeals(); refreshMeals(); }
    if (typeof refreshShop === 'function') { drawShop(); refreshShop(); }
  }

  const PAGE_GAP = 3;   // rem of empty space between skreens, so one never shows at the edge of its neighbour
  // Going past the last skreen carries on to the first, sliding the same way, as if it were skreen N+1
  // (and the same backwards). The first page is parked just after the last one for the slide, then put back.
  const pageX = (idx) => `translateX(calc(${-idx * 100}% - ${idx * PAGE_GAP}rem))`;
  function parkPage(page, slot) {   // slot: where it should sit, in pages from the first (n = after the last, -1 = before the first)
    clearTimeout(pager.wrapTimer);
    if (pager.wrapPage && pager.wrapPage !== page) pager.wrapPage.style.transform = '';
    pager.wrapPage = page;
    const shift = slot === -1 ? -pager.count : pager.count;
    page.style.transform = `translateX(calc(${shift * 100}% + ${shift * PAGE_GAP}rem))`;
  }
  function unparkPage() {
    clearTimeout(pager.wrapTimer);
    if (pager.wrapPage) { pager.wrapPage.style.transform = ''; pager.wrapPage = null; }
  }
  function settleWrap() {   // after the slide: pages back in place, the strip jumps (unseen) to the real position
    const track = document.querySelector('#dash .pager');
    unparkPage();
    if (!track) return;
    track.style.transition = 'none';
    track.style.transform = pager.count > 1 ? pageX(pager.index) : '';
    void track.offsetWidth;
    track.style.transition = '';
  }
  function setPage(i, { manual = false, instant = false } = {}) {
    const track = document.querySelector('#dash .pager');
    if (!track) return;
    const n = pager.count, pages = track.querySelectorAll(':scope > .page');
    const wrapFwd = n > 1 && i >= n, wrapBack = n > 1 && i < 0;
    pager.index = ((i % n) + n) % n;
    pager.changedAt = Date.now();
    if (instant) { unparkPage(); track.style.transition = 'none'; } else { track.style.transition = ''; }
    let slot = pager.index;
    if (wrapFwd && pages[0] && !instant) { parkPage(pages[0], n); slot = n; }
    else if (wrapBack && pages[n - 1] && !instant) { parkPage(pages[n - 1], -1); slot = -1; }
    track.style.transform = n > 1 ? pageX(slot) : '';
    if (instant) { void track.offsetWidth; track.style.transition = ''; }
    else if (pager.wrapPage) pager.wrapTimer = setTimeout(settleWrap, 900);
    document.querySelectorAll('#pageDots button').forEach((b, k) => b.classList.toggle('on', k === pager.index));
    if (manual) pager.changedAt = Date.now() + 15000;   // after a swipe, leave it alone for a while
  }
  function drawDots() {
    const box = $('pageDots');
    box.hidden = pager.count < 2;
    box.innerHTML = Array.from({ length: pager.count }, (_, k) => `<button type="button" data-page="${k}" class="${k === pager.index ? 'on' : ''}" aria-label="Skreen ${k + 1}"></button>`).join('');
  }
  $('pageDots').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) setPage(+b.dataset.page, { manual: true }); });

  // Swipe sideways between screens (a horizontal drag; vertical scrolling of lists is untouched).
  (function swipe() {
    const dash = $('dash');
    let sx = 0, sy = 0, dx = 0, active = false, moved = false, t0 = 0;
    dash.addEventListener('pointerdown', (e) => {
      if (pager.count < 2 || e.button > 0 || e.target.closest('input, textarea, select')) return;
      active = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0; t0 = Date.now();
    });
    dash.addEventListener('pointermove', (e) => {
      if (!active) return;
      dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) { moved = true; pager.dragging = true; try { dash.setPointerCapture(e.pointerId); } catch (_) {} }
      if (moved) {
        const track = dash.querySelector('.pager');
        track.style.transition = 'none';
        // At the ends, show the page that would come next (the first after the last, the last before the first).
        const n = pager.count, pages = track.querySelectorAll(':scope > .page');
        if (n > 1) {
          if (dx < 0 && pager.index === n - 1) { if (pager.wrapPage !== pages[0]) parkPage(pages[0], n); }
          else if (dx > 0 && pager.index === 0) { if (pager.wrapPage !== pages[n - 1]) parkPage(pages[n - 1], -1); }
          else unparkPage();
        }
        track.style.transform = `translateX(calc(${-pager.index * 100}% - ${pager.index * PAGE_GAP}rem + ${n < 2 ? dx / 3 : dx}px))`;
      }
    });
    const end = (e) => {
      if (!active) return;
      active = false;
      if (!moved) return;
      pager.dragging = false;
      const fast = Math.abs(dx) / Math.max(1, Date.now() - t0) > 0.5;
      const go = Math.abs(dx) > window.innerWidth * 0.18 || (fast && Math.abs(dx) > 40);
      const next = go ? pager.index + (dx < 0 ? 1 : -1) : pager.index;
      setPage(next, { manual: true });   // wraps round, like the automatic switching
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
    };
    let suppressClick = false;
    dash.addEventListener('pointerup', end);
    dash.addEventListener('pointercancel', end);
    dash.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
    document.addEventListener('keydown', (e) => {
      if (pager.count < 2 || dialogOpen() || tour.on || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
      if (e.key === 'ArrowRight') setPage(pager.index + 1, { manual: true });
      if (e.key === 'ArrowLeft') setPage(pager.index - 1, { manual: true });
    });
  })();

  // Automatic switching every so often (Settings → Layout), only while the screens are being looked at.
  setInterval(() => {
    const secs = Number(cfg.pageSeconds);
    if (pager.count < 2 || !secs || pager.dragging) return;
    if (tour.on || dialogOpen() || !$('night').hidden || alarm.on) return;
    if (Date.now() - pager.changedAt < secs * 1000) return;
    setPage(pager.index + 1);
  }, 1000);

  let layoutResizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(layoutResizeTimer); layoutResizeTimer = setTimeout(applyLayout, 300); });

  // ─── Photos widget (Skreen+) ────────────────────────────────────────────────

  const photo = { items: [], order: [], i: -1, source: '', listedAt: 0, timer: null, front: 'B', current: '' };
  const photosShown = () => hasPlus() && visibleWidgets().includes('photos');
  const photoSource = () => (cfg.photoSource === 'mine' && Photos.nativeOK() ? 'mine' : 'art');

  function showPhoto(item, then) {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      const back = photo.front === 'A' ? $('pfB') : $('pfA'), front = photo.front === 'A' ? $('pfA') : $('pfB');
      back.style.backgroundImage = `url("${img.src}")`;
      back.style.setProperty('--img', `url("${img.src}")`);
      back.classList.toggle('art', !!item.art);
      back.classList.add('on'); front.classList.remove('on');
      photo.front = photo.front === 'A' ? 'B' : 'A';
      photo.current = img.src;
      $('photoCaption').textContent = item.caption || '';
      then(true);
    };
    let triedSmall = false;
    img.onerror = () => { if (item.fallback && !triedSmall) { triedSmall = true; img.src = item.fallback; } else then(false); };   // the smaller copy of a painting, if the large one won't load
    img.src = item.url;
  }

  function nextPhoto(failures = 0) {
    clearTimeout(photo.timer);
    if (!photo.items.length || failures > 5) { $('photoNote').textContent = photo.items.length ? `Couldn\u2019t load the pictures right now (${photo.items.length} listed, e.g. ${(photo.order[photo.i] || photo.items[0]).url.replace(/^https?:\/\//, '').slice(0, 40)}).` : ''; return; }
    if (photo.i + 1 >= photo.order.length) { photo.order = Photos.shuffled(photo.items); photo.i = -1; }
    const item = photo.order[++photo.i];
    showPhoto(item, (ok) => {
      if (!ok) return nextPhoto(failures + 1);
      $('photoNote').textContent = '';
      photo.timer = setTimeout(() => nextPhoto(), Math.max(10, Number(cfg.photoSeconds) || 30) * 1000);
    });
  }

  async function syncPhotos(force = false) {
    clearTimeout(photo.timer);
    if (!photosShown()) return;
    const note = $('photoNote'), source = photoSource();
    if (force || source !== photo.source || (source === 'art' && Date.now() - photo.listedAt > 6 * 3600e3)) {
      note.textContent = 'Loading pictures\u2026';
      try {
        photo.items = source === 'mine' ? Photos.mine() : await Photos.art();
        photo.source = source; photo.listedAt = Date.now(); photo.order = []; photo.i = -1;
      } catch (err) {
        note.textContent = `Couldn\u2019t load the pictures right now (${(err && err.message) || 'no connection'}).`;
        photo.timer = setTimeout(() => syncPhotos(true), 3 * 60000);
        return;
      }
    }
    if (!photo.items.length) {
      note.textContent = source === 'mine' ? 'Choose some photos in Settings \u2192 Photos' : 'No pictures to show right now.';
      return;
    }
    nextPhoto();
  }

  // Settings → Photos: pick from the tablet / Google Photos, or use the art gallery.
  function drawPhotoSettings(fromSaved = false) {
    const mineOK = Photos.nativeOK();
    const sel = $('photoSource');
    sel.querySelector('option[value="mine"]').disabled = !mineOK;
    if (fromSaved) sel.value = photoSource();
    $('minePhotos').hidden = !mineOK || sel.value !== 'mine';
    const n = mineOK ? Photos.count() : 0;
    $('photoCount').textContent = n ? `${n} photo${n === 1 ? '' : 's'} on this tablet` : 'No photos chosen yet';
    $('photoClear').hidden = !n;
  }
  $('photoSource').addEventListener('change', () => drawPhotoSettings());
  $('photoPick').addEventListener('click', () => { $('photoCount').textContent = 'Opening your photos\u2026'; Photos.pick(); });
  $('photoClear').addEventListener('click', () => { Photos.clear(); drawPhotoSettings(); syncPhotos(true); });
  window.skreenPhotos = (done, total, finished, count) => {
    if (finished) { drawPhotoSettings(); syncPhotos(true); return; }
    $('photoCount').textContent = `Adding photos\u2026 ${done} of ${total}`;
  };

  // ─── In the news widget (Skreen+) ───────────────────────────────────────────

  const newsShown = () => hasPlus() && visibleWidgets().includes('news');
  let newsFailed = false, newsRetry = null;
  function drawNews() {
    const list = News.current;
    $('newsList').innerHTML = list.length
      ? list.map((s) => `<li class="news-item">${esc(s.text)}</li>`).join('')
      : `<li class="news-item news-empty">${newsFailed ? 'Couldn\u2019t load the news right now. Trying again soon.' : 'Loading the news\u2026'}</li>`;
  }
  async function syncNews(force = false) {
    clearTimeout(newsRetry);
    if (!newsShown()) return;
    newsFailed = false;
    drawNews();
    try {
      await News.stories(force);
    } catch (_) {
      newsFailed = true;                                   // keep what we have, say so if there's nothing, and retry
      newsRetry = setTimeout(() => syncNews(true), 3 * 60000);
    }
    drawNews();
  }

  // ─── Dinner planner (Skreen+) ───────────────────────────────────────────────
  // One Google Tasks list holds the dinners: each task is a meal and its due date is the day it's for.

  const mealsShown = () => hasPlus() && visibleWidgets().includes('meals');
  const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mealTarget = () => { const [a, l] = String(cfg.mealList || '').split('|'); return a && l && accountList().includes(a) ? { a, l } : null; };
  const mealState = { byDate: {}, ideas: [], ready: false, error: '' };

  function mealDays() {
    const today = startOfDay(new Date());
    return Array.from({ length: 7 }, (_, i) => { const d = addDays(today, i); return { date: ymdOf(d), d, i }; });
  }
  function drawMeals() {
    const box = $('mealList');
    if (!mealsShown() && !tour.on) return;
    if (!isDemo() && !mealTarget()) {
      $('mealsHint').textContent = '';
      box.innerHTML = `<button type="button" class="sk-cta" data-meal-setup>${canSignIn() ? 'Choose a Google Tasks list for dinners in Settings' : 'Dinners need the Android app and Google sign-in'}</button>`;
      return;
    }
    if (!mealState.ready) { box.innerHTML = mealDays().map(() => `<div class="meal skeleton"><ul>${[1].map(() => `<li>${sk(40, 1.3)}</li>`).join('')}</ul></div>`).join(''); return; }
    $('mealsHint').textContent = mealState.error ? 'Offline' : '';
    box.innerHTML = mealDays().map(({ date, d, i }) => {
      const items = mealState.byDate[date] || [];
      const name = i === 0 ? 'Tonight' : i === 1 ? 'Tomorrow' : fmtDate(d, { weekday: 'long' });
      const text = items.map((m) => `<span class="${m.done ? 'done' : ''}">${esc(m.title)}</span>`).join('<span class="sep"> + </span>');
      return `<button type="button" class="meal${i === 0 ? ' today' : ''}${items.length ? '' : ' empty'}" data-date="${date}"><span class="meal-day">${esc(name)}</span><span class="meal-what">${items.length ? text : 'Plan dinner'}</span></button>`;
    }).join('');
  }

  async function refreshMeals() {
    if (!mealsShown()) return;
    if (isDemo()) {
      const sample = ['Tacos', 'Sheet-pan chicken', 'Pasta night', 'Leftovers', 'Pizza & movie', 'Grilled salmon', 'Soup and bread'];
      mealState.byDate = {};
      mealDays().forEach(({ date }, i) => { mealState.byDate[date] = [{ id: 'd' + i, title: sample[i], done: false }]; });
      mealState.ideas = ['Tacos', 'Pasta night', 'Sheet-pan chicken', 'Chili', 'Grilled salmon', 'Stir fry'].map((title, i) => ({ id: 'i' + i, title }));
      mealState.ready = true; mealState.error = '';
      drawMeals();
      return;
    }
    const t = mealTarget();
    if (!t) { drawMeals(); return; }
    try {
      const days = mealDays();
      const items = await Google.mealTasks(t.a, t.l, days[0].date, days[6].date);
      mealState.byDate = {};
      items.forEach((m) => { (mealState.byDate[m.date] = mealState.byDate[m.date] || []).push(m); });
      try { mealState.ideas = await Google.mealIdeas(t.a, t.l); } catch (_) { /* ideas are optional */ }
      mealState.ready = true; mealState.error = '';
    } catch (err) {
      mealState.error = err.message || 'failed';
    }
    drawMeals();
  }

  // Shopping list: one Google Tasks list. Tap an item to tick it off; ticked items drop away on the next refresh.

  const shopShown = () => hasPlus() && visibleWidgets().includes('shop');
  const shopTarget = () => { const [a, l] = String(cfg.shopList || '').split('|'); return a && l && accountList().includes(a) ? { a, l } : null; };
  const shopState = { items: [], ready: false, error: '' };

  function drawShop() {
    const box = $('shopList');
    if (!shopShown() && !tour.on) return;
    const unset = !isDemo() && !shopTarget();
    $('shopAdd').hidden = unset;
    if (unset) {
      $('shopCount').textContent = '';
      box.innerHTML = `<li><button type="button" class="sk-cta" data-shop-setup>${canSignIn() ? 'Choose a Google Tasks list for shopping in Settings' : 'Shopping needs the Android app and Google sign-in'}</button></li>`;
      return;
    }
    if (!shopState.ready) { box.innerHTML = [1, 2, 3, 4].map(() => `<li class="task skeleton">${sk(60, 1.5)}</li>`).join(''); return; }
    const open = shopState.items.filter((t) => !t.done).length;
    $('shopCount').textContent = shopState.error ? 'Offline' : open ? `${open} to get` : '';
    box.innerHTML = shopState.items.length ? shopState.items.map((t) => `
      <li class="task${t.done ? ' done' : ''}" data-id="${esc(t.id)}"><span class="box"><span class="ico">${Icons.check}</span></span><span class="body"><span class="label">${esc(t.title)}</span></span></li>`).join('')
      : `<li class="task task-empty">${Icons.check}Nothing to buy</li>`;
  }

  async function refreshShop() {
    if (!shopShown()) return;
    if (isDemo()) {
      if (!shopState.ready) shopState.items = ['Milk', 'Eggs', 'Bananas', 'Bread', 'Dish soap', 'Coffee'].map((title, i) => ({ id: 's' + i, title, done: false }));
      shopState.ready = true; shopState.error = '';
      drawShop();
      return;
    }
    const t = shopTarget();
    if (!t) { drawShop(); return; }
    try {
      const all = await Google.tasks(t.a, t.l);
      shopState.items = all.filter((x) => !x.done).sort(byPosition);   // the same order as in Google Tasks
      shopState.ready = true; shopState.error = '';
    } catch (err) {
      shopState.error = err.message || 'failed';
    }
    drawShop();
  }

  async function toggleShop(id) {
    const it = shopState.items.find((x) => x.id === id), t = shopTarget();
    if (!it || (!t && !isDemo())) return;
    it.done = !it.done;
    drawShop();
    if (isDemo()) return;
    try { await Google.setDone(t.a, t.l, id, it.done); }
    catch (e) { it.done = !it.done; drawShop(); showToast('Couldn\u2019t update the list'); }
  }

  async function addShop() {
    const text = $('shopInput').value.trim(), t = shopTarget();
    if (!text) return;
    $('shopInput').value = '';
    $('shopInput').focus();
    const tmp = { id: 'tmp' + Date.now(), title: text, done: false };
    shopState.items.push(tmp);
    shopState.ready = true;
    drawShop();
    if (isDemo()) return;
    // One at a time, each placed after the last real item, so several quick adds keep their order.
    shopQueue = shopQueue.then(async () => {
      try {
        const prev = shopState.items.slice(0, shopState.items.indexOf(tmp)).reverse().find((x) => !String(x.id).startsWith('tmp'));
        const real = await Google.addTask(t.a, t.l, text, '', prev ? prev.id : '');
        tmp.id = real.id; tmp.position = real.position;
      } catch (e) { shopState.items = shopState.items.filter((x) => x !== tmp); drawShop(); showToast('Couldn\u2019t add that item'); }
    });
  }
  let shopQueue = Promise.resolve();

  $('shopList').addEventListener('click', (e) => {
    if (e.target.closest('[data-shop-setup]')) { if (canSignIn()) openSettings(); return; }
    const li = e.target.closest('.task[data-id]');
    if (li) toggleShop(li.dataset.id);
  });
  document.querySelectorAll('[data-w="agenda"] .col-head, [data-w="todo"] .col-head').forEach((h) => h.addEventListener('click', () => { refreshData(); showToast('Checking for changes\u2026'); }));
  $('shopAddIcon').innerHTML = Icons.plus || '+';
  $('shopAdd').addEventListener('click', () => { $('shopSheet').showModal(); setTimeout(() => $('shopInput').focus(), 50); });
  $('shopSave').addEventListener('click', addShop);
  $('shopCancel').addEventListener('click', () => $('shopSheet').close());
  $('shopInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addShop(); } });
  $('shopMic').innerHTML = Icons.mic;
  if (NATIVE && NATIVE.startVoice) $('shopMic').addEventListener('click', () => { voiceSink = (text) => { $('shopInput').value = capFirst(text); }; NATIVE.startVoice(); });
  else $('shopMic').hidden = true;

  let mealEditing = null;   // { date, first }
  function openMeal(date) {
    const d = mealDays().find((x) => x.date === date);
    if (!d) return;
    const items = mealState.byDate[date] || [];
    mealEditing = { date, first: items[0] || null };
    $('mealDay').textContent = d.i === 0 ? 'Tonight' : d.i === 1 ? 'Tomorrow' : fmtDate(d.d, { weekday: 'long', month: 'short', day: 'numeric' });
    $('mealHint').textContent = items.length > 1 ? `Also planned: ${items.slice(1).map((m) => m.title).join(', ')}` : 'What\u2019s for dinner?';
    $('mealInput').value = items[0] ? items[0].title : '';
    $('mealClear').hidden = !items[0];
    // The list's undated tasks, as one-tap choices.
    const planned = new Set(Object.values(mealState.byDate).flat().map((m) => m.title.toLowerCase()));
    const ideas = (mealState.ideas || []).slice(0, 14);
    $('mealIdeas').hidden = !ideas.length;
    $('mealIdeas').innerHTML = ideas.map((i) => `<button type="button" class="idea${planned.has(i.title.toLowerCase()) ? ' used' : ''}" data-idea="${esc(i.title)}">${esc(i.title)}</button>`).join('');
    $('mealSheet').showModal();
    setTimeout(() => $('mealInput').focus(), 50);
  }
  async function saveMeal(clear) {
    if (!mealEditing) return;
    const { date, first } = mealEditing, text = $('mealInput').value.trim(), t = mealTarget();
    $('mealSheet').close();
    if (!clear && !text) return;
    if (isDemo()) {
      if (clear) delete mealState.byDate[date];
      else mealState.byDate[date] = [{ id: 'd', title: text, done: false }];
      drawMeals();
      return;
    }
    if (!t) return;
    const before = JSON.stringify(mealState.byDate);
    // Show the change straight away; put it back if Google says no.
    if (clear) { const rest = (mealState.byDate[date] || []).slice(1); if (rest.length) mealState.byDate[date] = rest; else delete mealState.byDate[date]; }
    else if (first) mealState.byDate[date] = [{ ...first, title: text }, ...(mealState.byDate[date] || []).slice(1)];
    else mealState.byDate[date] = [{ id: 'tmp', title: text, done: false }];
    drawMeals();
    try {
      if (clear) await Google.deleteTask(t.a, t.l, first.id);
      else if (first) await Google.setTitle(t.a, t.l, first.id, text);
      else await Google.addMeal(t.a, t.l, text, date);
      refreshMeals();
    } catch (_) {
      mealState.byDate = JSON.parse(before);
      drawMeals();
      showToast('Couldn\u2019t save that dinner \u2014 check your connection');
    }
  }
  $('mealList').addEventListener('click', (e) => {
    if (e.target.closest('[data-meal-setup]')) { if (canSignIn()) openSettings(); return; }
    const b = e.target.closest('[data-date]');
    if (b && (isDemo() || mealTarget())) openMeal(b.dataset.date);
  });
  $('mealIdeas').addEventListener('click', (e) => { const b = e.target.closest('[data-idea]'); if (b) { $('mealInput').value = b.dataset.idea; saveMeal(false); } });
  $('mealSave').addEventListener('click', () => saveMeal(false));
  $('mealClear').addEventListener('click', () => saveMeal(true));
  $('mealCancel').addEventListener('click', () => $('mealSheet').close());
  $('mealInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveMeal(false); } });
  $('mealMic').innerHTML = Icons.mic;
  if (NATIVE && NATIVE.startVoice) {
    $('mealMic').addEventListener('click', () => { voiceSink = (text) => { $('mealInput').value = capFirst(text); }; NATIVE.startVoice(); });
  } else if (!SR) {
    $('mealMic').hidden = true;
  } else {
    let mrec = null;
    $('mealMic').addEventListener('click', () => {
      if (mrec) { mrec.stop(); return; }
      mrec = new SR(); mrec.lang = navigator.language || 'en-US';
      mrec.onresult = (e) => { $('mealInput').value = capFirst(Array.from(e.results).map((r) => r[0].transcript).join(' ')); };
      mrec.onend = () => { mrec = null; $('mealMic').classList.remove('listening'); };
      mrec.onerror = mrec.onend;
      $('mealMic').classList.add('listening');
      mrec.start();
    });
  }

  // The editor in Settings: a tick to show/hide and arrows to reorder (no dragging on a wall display).
  let draftLayout = null;
  function drawPlusCard() {
    const on = Plus.active(), st = Plus.state;
    $('plusCard').classList.toggle('on', on);
    $('layoutField').classList.toggle('locked', !on);
    $('photoField').classList.toggle('locked', !on);
    ['mealField', 'shopField', 'bigField'].forEach((id) => $(id).classList.toggle('locked', !on));
    if (!on && form.elements.bigMode.value === '1') { form.elements.bigMode.value = '0'; drawSlideOpts(); }
    $('plusText').innerHTML = on
      ? '<b>Skreen+ is unlocked.</b> Thank you. It\u2019s yours for good.'
      : 'One payment unlocks Skreen+: several Google accounts and to-do lists, your own layout, an always-on slideshow and more. Everything you see on the main skreen today stays free.';
    $('plusBuy').hidden = on || !st.canBuy;
    $('plusBuy').textContent = st.price ? `Unlock Skreen+ \u00b7 ${st.price}` : 'Unlock Skreen+';
    $('plusForget').hidden = !(on && st.code);
    const actions = !($('plusBuy').hidden && $('plusForget').hidden);
    $('plusActions').hidden = !actions;
    $('plusCard').classList.toggle('no-actions', !actions);
    $('plusCodeBox').hidden = on;
  }
  $('plusBuy').addEventListener('click', () => Plus.buy());

  // A free user tried a Skreen+ option: say so, and offer to unlock it. (A toast would sit behind Settings.)
  function offerPlus(why) {
    if (hasPlus()) return;
    const st = Plus.state;
    $('plusWhy').textContent = why;
    $('plusSheetBuy').hidden = !st.canBuy;
    $('plusSheetBuy').textContent = st.price ? `Unlock Skreen+ \u00b7 ${st.price}` : 'Unlock Skreen+';
    $('plusSheet').showModal();
  }
  $('plusSheetClose').addEventListener('click', () => $('plusSheet').close());
  $('plusSheetBuy').addEventListener('click', () => { $('plusSheet').close(); Plus.buy(); });
  $('plusSheetCode').addEventListener('click', () => {
    $('plusSheet').close();
    $('plusCodeBox').open = true;
    showTab('plus');
    $('plusCard').scrollIntoView({ block: 'center' });
    setTimeout(() => $('plusCode').focus(), 50);
  });
  const PLUS_FIELDS = { layoutField: 'Choosing and arranging your own layout is part of Skreen+.', photoField: 'The photo slideshow is part of Skreen+.', mealField: 'The dinner planner is part of Skreen+.', shopField: 'The shopping list is part of Skreen+.', bigField: 'Big Skreen Mode is part of Skreen+.' };
  Object.entries(PLUS_FIELDS).forEach(([id, why]) => {
    $(id).addEventListener('click', (e) => { if (!hasPlus()) { e.preventDefault(); e.stopPropagation(); offerPlus(why); } }, true);
    $(id).addEventListener('focusin', (e) => { if (!hasPlus()) { e.target.blur(); offerPlus(why); } });
  });

  $('plusForget').addEventListener('click', () => Plus.forgetCode());
  // The code field fixes itself as you type: capital letters, the SKR- start and the hyphens are added for you.
  const formatCode = (raw) => {
    let s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length > 16 && s.startsWith('SKR')) s = s.slice(3);   // someone typed or pasted the SKR start too
    return (s.slice(0, 16).match(/.{1,4}/g) || []).join('-');
  };
  $('plusCode').addEventListener('input', (e) => { e.target.value = formatCode(e.target.value); });
  $('plusCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('plusRedeem').click(); } });
  $('plusRedeem').addEventListener('click', async () => {
    const ok = await Plus.redeem($('plusCode').value);
    $('plusResult').textContent = ok ? 'Unlocked. Thank you!' : 'That code didn\u2019t work.';
    $('plusResult').className = 'test-result ' + (ok ? 'ok' : 'bad');
    if (ok) $('plusCode').value = '';
  });

  function drawLayoutEditor() {
    const box = $('layoutList');
    // Which screen each visible widget lands on, so the list can show where a new screen starts.
    const screenOf = {};
    paginate(buildLanes(draftLayout.filter((w) => w.on).map((w) => w.id))).forEach((lanes, n) => lanes.forEach((l) => l.ids.forEach((id) => { screenOf[id] = n; })));
    let last = 0;
    box.innerHTML = draftLayout.map((w, i) => {
      let marker = '';
      if (w.on && screenOf[w.id] !== last) { last = screenOf[w.id]; marker = `<div class="layout-screen">Skreen ${last + 1}</div>`; }
      return `${marker}<div class="layout-row${w.on ? '' : ' off'}">
      <label class="check"><input type="checkbox" data-i="${i}" ${w.on ? 'checked' : ''}> ${esc(WIDGETS[w.id])}</label>
      <button type="button" class="btn ghost small" data-up="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${Icons.up}</button>
      <button type="button" class="btn ghost small" data-down="${i}" aria-label="Move down" ${i === draftLayout.length - 1 ? 'disabled' : ''}>${Icons.down}</button></div>`;
    }).join('');
  }
  $('layoutList').addEventListener('click', (e) => {
    const up = e.target.closest('[data-up]'), down = e.target.closest('[data-down]');
    const i = up ? +up.dataset.up : down ? +down.dataset.down : -1;
    if (i < 0) return;
    const j = up ? i - 1 : i + 1;
    [draftLayout[i], draftLayout[j]] = [draftLayout[j], draftLayout[i]];
    drawLayoutEditor();
  });
  $('layoutList').addEventListener('change', (e) => {
    const i = +e.target.dataset.i, w = draftLayout[i];
    if (!w) return;
    if (!e.target.checked && draftLayout.filter((x) => x.on).length === 1) { e.target.checked = true; showToast('Keep at least one thing on skreen'); return; }
    w.on = e.target.checked;
    drawLayoutEditor();
  });

  // ─── Settings sheet ────────────────────────────────────────────────────────

  const settingsSheet = $('settingsSheet'), form = $('settingsForm');
  form.elements.bigMode.addEventListener('change', (e) => {
    if (e.target.value === '1' && !hasPlus()) { e.target.value = '0'; offerPlus('Big Skreen Mode is part of Skreen+.'); }
    drawSlideOpts();
  });
  // Always-on slideshow options: how long each slide stays, and which ones to leave out.
  function drawSlideOpts() {
    const on = form.elements.bigMode.value === '1' && hasPlus();
    $('alwaysOpts').hidden = !on;
    const skip = String(cfg.slideSkip || '').split(',');
    // Say why a slide won't appear: its widget is off (that switch lives under Widgets), or it has nothing to show yet.
    const note = (id) => {
      if (id === 'music') return { text: 'Appears while music is playing' };
      if (!visibleWidgets().includes(TOUR_ALL[id])) return { text: 'Not showing: this widget is off', go: true };
      if (id === 'photos' && !photo.current) return { text: 'Not showing yet: no picture has loaded' };
      if (id === 'news' && !News.current.length) return { text: 'Not showing yet: no headlines have loaded' };
      if (id === 'meals' && !(mealState.ready && Object.keys(mealState.byDate).length)) return { text: 'Not showing yet: no dinners are planned' };
      if (id === 'shop' && !shopState.items.length) return { text: 'Not showing yet: your shopping list is empty' };
      if (['agenda', 'todo'].includes(id) && !state.loaded) return { text: 'Not showing yet: nothing has loaded' };
      return null;
    };
    $('slideChecks').innerHTML = Object.entries(SLIDE_NAMES).map(([id, name]) => {
      const n = note(id);
      return `<div class="slide-row"><label class="check"><input type="checkbox" data-slide="${id}" ${skip.includes(id) ? '' : 'checked'}>${esc(name)}</label>` +
        (n ? `<span class="slide-note">${esc(n.text)}${n.go ? ' <button type="button" class="linklike" data-goto="widgets">Turn it on in Widgets</button>' : ''}</span>` : '') + '</div>';
    }).join('');
  }
  $('slideChecks').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) showTab(b.dataset.goto); });

  // ─── Other calendars (published links) ─────────────────────────────────────

  let draftIcs = [];
  function drawIcs() {
    $('icsList').hidden = !draftIcs.length;
    $('icsList').innerHTML = draftIcs.map((c, i) => `<label class="check"><i style="background:${esc(c.color)}"></i><span>${esc(c.name)}</span><button type="button" class="btn ghost small" data-rm-ics="${i}">Remove</button></label>`).join('');
  }
  $('icsList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm-ics]');
    if (b) { draftIcs.splice(+b.dataset.rmIcs, 1); drawIcs(); }
  });
  $('icsAddBtn').addEventListener('click', async () => {
    const out = $('icsResult');
    let link = $('icsUrl').value.trim();
    if (!link) { out.textContent = 'Paste a calendar link first.'; return; }
    if (/^webcal:/i.test(link)) link = 'https:' + link.slice(7);
    if (!/^https:\/\//i.test(link)) { out.textContent = 'The link should start with https:// or webcal://'; return; }
    if (draftIcs.length >= 8) { out.textContent = 'That\u2019s the most calendars Skreen can show.'; return; }
    out.className = 'test-result'; out.textContent = 'Checking the link\u2026';
    try {
      const r = await Ics.test(link);
      const name = $('icsName').value.trim() || r.name || 'Calendar ' + (draftIcs.length + 1);
      draftIcs.push({ id: Math.random().toString(36).slice(2, 8), name, url: link, color: Ics.COLORS[draftIcs.length % Ics.COLORS.length] });
      $('icsUrl').value = ''; $('icsName').value = '';
      out.textContent = `\u2713 Added \u201c${name}\u201d (${r.count} events in the next 30 days). Save to show it.`;
      drawIcs();
    } catch (err) {
      out.textContent = err.message === 'not a calendar' ? 'That link isn\u2019t a calendar feed. It should end in .ics or come from \u201cpublish calendar\u201d.' : `Couldn\u2019t read that link (${err.message}).`;
    }
  });
  $('icsHelp').addEventListener('click', (e) => { e.preventDefault(); settingsSheet.close(); openGuide('calendars'); });

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
  $('accentSelect').addEventListener('change', (e) => applyAccent(e.target.value));   // live preview
  settingsSheet.addEventListener('close', () => applyAccent(cfg.accent));

  // Settings is a full page with a menu of sections down the left.
  let settingsTab = 'display';
  function showTab(id) {
    settingsTab = id;
    document.querySelectorAll('#settingsNav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    document.querySelectorAll('.stab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
    $('settingsScroll').scrollTop = 0;
  }
  $('settingsNav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

  function openSettings() {
    showTab(settingsTab);
    fillBackgroundOptions();
    fillTimeOptions();
    for (const el of form.elements) if (el.name && el.name in cfg) el.value = cfg[el.name] ?? '';
    if (!hasPlus()) form.elements.bigMode.value = '0';
    drawPhotoSettings(true);
    drawSlideOpts();
    draftIcs = (cfg.ics || []).map((c) => ({ ...c }));
    drawIcs();
    $('icsResult').textContent = '';
    draftLayout = parseLayout(cfg.layout);
    drawLayoutEditor();
    drawPlusCard();
    $('plusResult').textContent = '';
    draftLoc = cfg.lat != null ? { lat: cfg.lat, lon: cfg.lon, place: cfg.place } : null;
    $('locCurrent').textContent = draftLoc ? `✓ ${draftLoc.place}` : 'No location set';
    $('locResults').innerHTML = '';
    settingsSheet.showModal();
    fillGoogleSection();
    refreshAppSection();
  }

  // Android app: the signed-in Google accounts, with the calendars and to-do lists to show from each.
  // Several accounts and several lists are Skreen+; without it, the first account and one list.
  let acctChoices = {};
  async function fillGoogleSection() {
    acctChoices = {};
    const box = $('acctBox');
    if (!canSignIn()) { box.innerHTML = ''; return; }
    const all = usingGoogle() ? accountList() : [];
    const plus = hasPlus();
    if (!all.length) {
      box.innerHTML = '<div class="field"><span>Not signed in. Showing sample data.</span><div class="loc-row"><button type="button" class="btn ghost small" data-acct="add">Sign in with Google</button></div></div>';
      return;
    }
    box.innerHTML = all.map((a, i) => `<div class="acct" data-a="${esc(a)}">
        <div class="acct-head"><b>${esc(a)}</b>${i > 0 && !plus ? '<em>needs Skreen+</em>' : ''}<button type="button" class="btn ghost small" data-acct="remove" data-who="${esc(a)}">${all.length === 1 ? 'Sign out' : 'Remove'}</button></div>
        <div class="acct-body" ${i > 0 && !plus ? 'hidden' : ''}>Loading\u2026</div>
      </div>`).join('') +
      `<div class="loc-row"><button type="button" class="btn ghost small" data-acct="add">${plus ? 'Add another Google account' : 'Add another account \u00b7 Skreen+'}</button></div>
       <label class="field" id="addToField" hidden><span>New to-dos go to</span><select id="addToPick"></select></label>`;
    await Promise.all(all.map(async (a, i) => {
      const body = box.querySelector(`.acct[data-a="${CSS.escape(a)}"] .acct-body`);
      if (i > 0 && !plus) return;
      try {
        const [cals, lists] = await Promise.all([Google.listCalendars(a, true), Google.listTaskLists(a)]);
        const chosenCals = new Set(Google.chosenCalendars(cals, (cfg.calSel || {})[a]).map((c) => c.id));
        let chosenLists = ((cfg.listSel || {})[a] || []);
        if (!chosenLists.length) chosenLists = [await Google.resolveList(a, '')];
        if (!plus) chosenLists = chosenLists.slice(0, 1);
        acctChoices[a] = { cals, lists };
        const kind = plus ? 'checkbox' : 'radio';
        body.innerHTML = `<span class="sub">Calendars to show</span><div class="checks">${cals.map((c) => `<label class="check"><input type="checkbox" data-cal="${esc(c.id)}" ${chosenCals.has(c.id) ? 'checked' : ''}><i style="background:${esc(c.color)}"></i><span>${esc(c.name)}</span></label>`).join('')}</div>
          <span class="sub">${plus ? 'To-do lists to show' : 'To-do list'}</span><div class="checks">${lists.map((l) => `<label class="check"><input type="${kind}" name="list-${esc(a)}" data-list="${esc(l.id)}" ${chosenLists.includes(l.id) ? 'checked' : ''}><span>${esc(l.title)}</span></label>`).join('')}</div>`;
      } catch (e) {
        if (e instanceof Google.AuthError) body.innerHTML = '<span class="sub">Google needs you to sign in again to use this account.</span><div class="loc-row"><button type="button" class="btn ghost small" data-acct="resign">Sign in again</button></div>';
        else body.textContent = 'Couldn\u2019t load this account. Check your connection.';
      }
    }));
    drawAddTo();
    drawMealPick(all);
    drawShopPick(all);
  }
  // The dinner planner's list: any Google Tasks list on a signed-in account.
  function drawMealPick(all) {
    const sel = $('mealPick');
    const opts = [];
    all.forEach((a) => { const c = acctChoices[a]; if (c) c.lists.forEach((l) => opts.push({ v: `${a}|${l.id}`, label: `${l.title}${all.length > 1 ? ' \u00b7 ' + a : ''}` })); });
    // Offer a list that already looks like a dinner list as the default.
    const guess = opts.find((o) => /dinner|meal/i.test(o.label));
    const cur = cfg.mealList || (guess ? guess.v : '');
    sel.innerHTML = '<option value="">Not set</option>' + opts.map((o) => `<option value="${esc(o.v)}" ${o.v === cur ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  }
  function drawShopPick(all) {
    const sel = $('shopPick');
    const opts = [];
    all.forEach((a) => { const c = acctChoices[a]; if (c) c.lists.forEach((l) => opts.push({ v: `${a}|${l.id}`, label: `${l.title}${all.length > 1 ? ' \u00b7 ' + a : ''}` })); });
    const guess = opts.find((o) => /shop|grocer/i.test(o.label));
    const cur = cfg.shopList || (guess ? guess.v : '');
    sel.innerHTML = '<option value="">Not set</option>' + opts.map((o) => `<option value="${esc(o.v)}" ${o.v === cur ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  }
  // Where new to-dos go, when more than one list is shown.
  function drawAddTo() {
    const picks = [];
    $('acctBox').querySelectorAll('.acct').forEach((el) => {
      el.querySelectorAll('input[data-list]:checked').forEach((inp) => {
        const a = el.dataset.a, l = acctChoices[a] && acctChoices[a].lists.find((x) => x.id === inp.dataset.list);
        picks.push({ v: `${a}|${inp.dataset.list}`, label: `${l ? l.title : 'List'}${accountList().length > 1 ? ' \u00b7 ' + a : ''}` });
      });
    });
    const field = $('addToField');
    if (!field) return;
    field.hidden = picks.length < 2;
    const cur = picks.some((p) => p.v === cfg.addTo) ? cfg.addTo : (picks[0] || {}).v;
    $('addToPick').innerHTML = picks.map((p) => `<option value="${esc(p.v)}" ${p.v === cur ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
  }
  $('acctBox').addEventListener('change', (e) => { if (e.target.matches('input[data-list]')) drawAddTo(); });
  $('acctBox').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acct]');
    if (!b) return;
    if (b.dataset.acct === 'add') {
      if (usingGoogle() && !hasPlus() && accountList().length >= 1) { offerPlus('Using several Google accounts is part of Skreen+.'); return; }
      if (await startSignIn()) fillGoogleSection();
    } else if (b.dataset.acct === 'resign') {
      if (await startSignIn()) fillGoogleSection();
    } else if (b.dataset.acct === 'remove') {
      removeAccount(b.dataset.who);
      fillGoogleSection();
    }
  });
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
      const results = await Weather.search(q);
      if (!results.length) { $('locResults').textContent = 'No matches.'; return; }
      $('locResults').innerHTML = '';
      results.forEach((r) => {
        const place = formatPlace({ city: r.name, region: r.region, country: r.country });
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = place;
        b.onclick = () => setDraftLoc({ lat: r.lat, lon: r.lon, place });
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

  form.addEventListener('submit', () => {
    for (const el of form.elements) if (el.name && el.name in cfg) cfg[el.name] = el.value.trim();
    if (draftLoc) Object.assign(cfg, draftLoc);
    cfg.ics = draftIcs;
    if (hasPlus()) cfg.slideSkip = Array.from($('slideChecks').querySelectorAll('input:not(:checked)')).map((i) => i.dataset.slide).join(',');
    if (draftLayout && hasPlus()) cfg.layout = serializeLayout(draftLayout);
    document.querySelectorAll('#acctBox .acct').forEach((el) => {
      const acct = el.dataset.a;
      if (!acctChoices[acct] || el.querySelector('.acct-body[hidden]')) return;
      const cals = Array.from(el.querySelectorAll('input[data-cal]:checked')).map((x) => x.dataset.cal);
      cfg.calSel = cfg.calSel || {}; cfg.listSel = cfg.listSel || {};
      cfg.calSel[acct] = cals.length ? cals : acctChoices[acct].cals.filter((c) => c.primary).map((c) => c.id);
      cfg.listSel[acct] = Array.from(el.querySelectorAll('input[data-list]:checked')).map((x) => x.dataset.list);
    });
    if ($('addToPick') && !$('addToField').hidden) cfg.addTo = $('addToPick').value;
    if ($('mealPick') && $('mealPick').options.length > 1 && hasPlus()) cfg.mealList = $('mealPick').value;
    if ($('shopPick') && $('shopPick').options.length > 1 && hasPlus()) cfg.shopList = $('shopPick').value;
    Google.forgetCaches();
    saveSettings();
    scheduleData();
    state.nightDismissedUntil = 0;
    state.bgKey = '';
    if (tour.on && tour.big && !alwaysTour()) endTour();   // Big Skreen Mode was switched off
    tour.last = alwaysTour() ? 0 : Date.now();   // always-on starts right away; the others wait their usual time
    lastMinute = -1;
    applyLayout();
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
      keepAwake(); if (Date.now() - (state.lastSync ? state.lastSync.getTime() : 0) > 2 * 60000) refreshData(); refreshWeather();
      if (canUpdate() && Date.now() - lastUpdateCheck > 15 * 60000) backgroundUpdateCheck();
    }
  });

  // ─── Keeping the wall up to date ───────────────────────────────────────────
  // Each deploy stamps this page's script address with a version. Every half hour Skreen asks the
  // site which version is current and, if a newer one exists, reloads itself once nobody is using it.

  const loadedStamp = ((document.querySelector('script[src*="app.js"]') || { getAttribute: () => '' }).getAttribute('src').match(/[?&]v=([^&]+)/) || [])[1];
  const SITE_CHECK_MS = 30 * 60000, QUIET_MS = 2 * 60000;
  let newerSite = false, lastTouch = 0;
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { lastTouch = Date.now(); }, true));

  async function checkSiteVersion() {
    if (!loadedStamp || loadedStamp === 'dev') return;          // a local or bundled copy: nothing to compare
    try {
      const res = await fetch(`index.html?_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const m = (await res.text()).match(/app\.js\?v=([A-Za-z0-9]+)/);
      if (m && m[1] !== loadedStamp) newerSite = true;
    } catch (_) { /* offline: try again later */ }
  }
  function quietEnough() {
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    return !dialogOpen() && (!tour.on || tour.big) && !state.mutating && !typing && !timers.length &&
      !$('toast').classList.contains('show') && Date.now() - lastTouch > QUIET_MS;
  }
  function maybeSelfReload() { if (newerSite && quietEnough()) location.reload(); }

  // Android back button: close whatever is open, never leave the app.
  window.skreenBack = () => {
    if (tour.on && !tour.big) { endTour(); return true; }
    if (!guide.hidden) { closeGuide(); return true; }
    const open = document.querySelector('dialog[open]');
    if (open) { open.close(); return true; }
    return false;
  };

  // ─── Boot ──────────────────────────────────────────────────────────────────

  function boot() {
    document.querySelectorAll('[data-brand]').forEach((el) => { el.innerHTML = Icons.logo; });
    document.querySelectorAll('[data-plus-logo]').forEach((el) => { el.innerHTML = Icons.logoPlus; });
    applyLayout();
    let plusWas = false;
    Plus.init(() => {
      applyLayout();
      if (settingsSheet.open) { drawPlusCard(); fillGoogleSection(); }
      if (hasPlus() !== plusWas) { plusWas = hasPlus(); refreshData(); }   // Plus decides which accounts and lists are shown
    });
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
    syncWeatherSkeleton();
    tick();
    timerLoop();
    refreshData();
    refreshWeather();
    nameCurrentLocation();     // also fixes up a location saved earlier as "Current location"
    keepAwake();
    applyBrightness();
    maybeWelcome();
    setTimeout(checkSiteVersion, 60000); setInterval(checkSiteVersion, SITE_CHECK_MS);
    if (canUpdate()) { setTimeout(backgroundUpdateCheck, 20000); setInterval(backgroundUpdateCheck, UPDATE_CHECK_MS); }
    setInterval(() => syncNews(true), 30 * 60000);
    setInterval(refreshMeals, 10 * 60000);
    setInterval(refreshShop, 5 * 60000);
    scheduleData();
    setInterval(refreshWeather, REFRESH_WEATHER_MS);
    if ('serviceWorker' in navigator && location.protocol === 'https:' && location.hostname !== 'appassets.androidplatform.net') navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  boot();
})();
