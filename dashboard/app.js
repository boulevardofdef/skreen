/* Kitchen Dashboard — wall display for calendar, to-dos, weather and photos. */
(() => {
  'use strict';

  // ─── Settings (stored on this device) ──────────────────────────────────────

  const DEFAULTS = {
    backendUrl: '',
    secret: '',
    lat: null,
    lon: null,
    place: '',
    units: 'fahrenheit',
    clock: '12',
    nightEnabled: '1',
    nightStart: '22:30',
    nightEnd: '06:00',
    photoMinutes: '5',
  };
  const STORE_KEY = 'kitchen-dashboard-settings';

  function loadSettings() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (_) {}
  }

  let cfg = loadSettings();
  const isDemo = () => !cfg.backendUrl;

  const REFRESH_DATA_MS = 2 * 60 * 1000;
  const REFRESH_WEATHER_MS = 15 * 60 * 1000;
  const AGENDA_DAYS = 7;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ─── State ─────────────────────────────────────────────────────────────────

  const state = {
    events: [],
    tasks: [],
    weather: null,
    lastSync: null,
    syncError: null,
    photosEnabled: false,
    mutating: 0,
    lastMutation: 0,
    nightDismissedUntil: 0,
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

  async function refreshData() {
    if (isDemo()) {
      state.events = demoEvents();
      state.tasks = demoTasks.load();
      state.lastSync = new Date();
      renderAgenda();
      renderTasks();
      renderStatus();
      updateNight();
      return;
    }
    try {
      const data = await api('dashboard');
      state.events = data.events || [];
      // Don't clobber the list while a tap is still being saved.
      if (!state.mutating && Date.now() - state.lastMutation > 4000) state.tasks = data.tasks || [];
      const hadPhotos = state.photosEnabled;
      state.photosEnabled = !!data.photos;
      state.lastSync = new Date();
      state.syncError = null;
      renderAgenda();
      renderTasks();
      updateNight();
      if (state.photosEnabled && !hadPhotos) nextPhoto();
    } catch (err) {
      state.syncError = err.message || String(err);
      console.warn('Sync failed', err);
    }
    renderStatus();
  }

  // ─── Time helpers ──────────────────────────────────────────────────────────

  const DAY = 86400000;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const parseDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  function timeParts(d) {
    if (cfg.clock === '24') {
      return { hm: d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'), ap: '' };
    }
    const h = d.getHours() % 12 || 12;
    return { hm: h + ':' + d.getMinutes().toString().padStart(2, '0'), ap: d.getHours() < 12 ? 'AM' : 'PM' };
  }
  function fmtTime(d, { small = false } = {}) {
    const { hm, ap } = timeParts(d);
    if (!ap) return hm;
    return small ? `${hm}<small>${ap}</small>` : `${hm} ${ap}`;
  }
  const fmtDate = (d, opts) => d.toLocaleDateString(undefined, opts);

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
    $('time').textContent = hm;
    $('ampm').textContent = ap;
    $('date').textContent = fmtDate(now, { weekday: 'long', month: 'long', day: 'numeric' });

    if (now.getMinutes() !== lastMinute) {
      lastMinute = now.getMinutes();
      setPeriod(now);
      renderAgenda();
      updateNight(now);
      // Fresh start every night: picks up app updates and keeps memory tidy.
      if (now.getHours() === 3 && now.getMinutes() === 30) location.reload();
    }
    setTimeout(tick, 1000 - now.getMilliseconds() + 5);
  }

  function setPeriod(now) {
    const h = now.getHours() + now.getMinutes() / 60;
    const w = state.weather && state.weather.daily;
    const sunrise = w ? hourOf(w.sunrise[0]) : 6.5;
    const sunset = w ? hourOf(w.sunset[0]) : 18.5;
    let p = 'night';
    if (h >= sunrise - 1 && h < sunrise + 1.5) p = 'dawn';
    else if (h >= sunrise + 1.5 && h < sunset - 1) p = 'day';
    else if (h >= sunset - 1 && h < sunset + 1) p = 'dusk';
    document.body.dataset.period = p;
  }
  const hourOf = (iso) => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };

  // ─── Agenda ────────────────────────────────────────────────────────────────

  function normalizeEvent(e) {
    if (e.allDay) return { ...e, s: parseDate(e.start), e: parseDate(e.end) };
    return { ...e, s: new Date(e.start), e: new Date(e.end) };
  }

  function renderAgenda() {
    const el = $('agenda');
    const now = new Date();
    const today = startOfDay(now);
    const events = state.events.map(normalizeEvent);
    let html = '';
    let shownDays = 0;

    for (let i = 0; i < AGENDA_DAYS; i++) {
      const dayStart = addDays(today, i);
      const dayEnd = addDays(today, i + 1);
      const inDay = events.filter((ev) => ev.s < dayEnd && ev.e > dayStart);
      const allDay = inDay.filter((ev) => ev.allDay);
      let timed = inDay.filter((ev) => !ev.allDay).sort((a, b) => a.s - b.s);
      const endedToday = i === 0 ? timed.filter((ev) => ev.e <= now).length : 0;
      if (i === 0) timed = timed.filter((ev) => ev.e > now);

      if (i > 0 && !allDay.length && !timed.length) continue;
      shownDays++;

      const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(dayStart, { weekday: 'long' });
      const sub = fmtDate(dayStart, i < 2 ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });

      html += `<div class="day${i >= 2 ? ' later' : ''}">`;
      html += `<div class="day-head"><span class="name">${name}</span><span class="sub">${esc(sub)}</span></div>`;
      if (allDay.length) {
        html += '<div class="allday">' + allDay.map((ev) =>
          `<span class="pill" style="--c:${esc(ev.color || '#8ab4f8')}">${esc(ev.title)}</span>`).join('') + '</div>';
      }
      if (i === 0 && !timed.length) {
        html += `<div class="empty"><span class="msr">${endedToday ? 'done_all' : 'wb_sunny'}</span>${
          endedToday ? 'That’s everything for today' : 'Nothing scheduled today'}</div>`;
      }
      html += timed.map((ev) => eventCard(ev, now, dayStart, dayEnd)).join('');
      html += '</div>';
    }
    if (shownDays === 1 && events.length === 0 && !isDemo() && !state.lastSync) html = '';
    el.innerHTML = html;
  }

  function eventCard(ev, now, dayStart, dayEnd) {
    const running = ev.s <= now && ev.e > now;
    const minsAway = (ev.s - now) / 60000;
    const soon = !running && minsAway >= 0 && minsAway <= 60;

    let start, end;
    if (ev.s < dayStart && ev.e > dayEnd) { start = 'All day'; end = ''; }
    else if (ev.s < dayStart) { start = 'Until'; end = fmtTime(ev.e); }
    else {
      start = fmtTime(ev.s, { small: true });
      end = ev.e <= dayEnd ? fmtTime(ev.e) : 'Overnight';
    }

    let chip = '';
    if (running) chip = '<span class="chip">Now</span>';
    else if (soon) chip = `<span class="chip">${relMinutes(minsAway)}</span>`;

    const meta = [];
    if (ev.location) meta.push(`<span class="msr">location_on</span>${esc(ev.location.split('\n')[0])}`);
    else if (ev.calendar) meta.push(esc(ev.calendar));

    const progress = running
      ? `<div class="progress" style="width:${Math.min(100, ((now - ev.s) / (ev.e - ev.s)) * 100).toFixed(1)}%"></div>`
      : '';

    return `<div class="event${running ? ' now' : soon ? ' soon' : ''}" style="--c:${esc(ev.color || '#8ab4f8')}">
      <div class="when"><div class="start">${start}</div>${end ? `<div class="end">${end}</div>` : ''}</div>
      <div><div class="title">${esc(ev.title)}${chip}</div>${meta.length ? `<div class="meta">${meta.join(' · ')}</div>` : ''}</div>
      ${progress}
    </div>`;
  }

  // ─── To-do list ────────────────────────────────────────────────────────────

  function renderTasks() {
    const list = $('tasks');
    const open = state.tasks.filter((t) => !t.done);
    $('taskCount').textContent = open.length || '';
    if (!state.tasks.length) {
      list.innerHTML = `<li class="task task-empty"><div><span class="msr">task_alt</span>All caught up</div></li>`;
      return;
    }
    list.innerHTML = state.tasks.map((t) => `
      <li class="task${t.done ? ' done' : ''}${t.pending ? ' pending' : ''}" data-id="${esc(t.id)}">
        <span class="box"><span class="msr">check</span></span>
        <span class="label">${esc(t.title)}</span>
      </li>`).join('');
  }

  async function mutate(fn) {
    state.mutating++;
    try { return await fn(); }
    finally { state.mutating--; state.lastMutation = Date.now(); }
  }

  function completeTask(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t || t.done || t.pending) return;
    t.done = true;
    t._index = state.tasks.indexOf(t);
    renderTasks();

    setTimeout(() => {
      if (!t.done) return; // undone in the meantime
      const li = $('tasks').querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (li) li.classList.add('leaving');
      setTimeout(() => {
        if (!t.done) return;
        state.tasks = state.tasks.filter((x) => x !== t);
        renderTasks();
      }, 500);
    }, 1100);

    showToast(`Done: ${t.title}`, 'Undo', () => {
      t.done = false;
      if (!state.tasks.includes(t)) state.tasks.splice(Math.min(t._index ?? 0, state.tasks.length), 0, t);
      renderTasks();
      if (isDemo()) return demoTasks.save(state.tasks);
      mutate(() => api('uncompleteTask', { id })).catch(() => showToast('Couldn’t undo — check your connection'));
    });

    if (isDemo()) return demoTasks.save(state.tasks.filter((x) => x !== t));
    mutate(() => api('completeTask', { id })).catch(() => {
      t.done = false;
      if (!state.tasks.includes(t)) state.tasks.splice(t._index, 0, t);
      renderTasks();
      showToast('Couldn’t save — check your connection');
    });
  }

  function addTasks(text) {
    const titles = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    titles.reverse().forEach((title) => {
      const tmp = { id: 'tmp-' + Math.random().toString(36).slice(2), title, pending: !isDemo() };
      state.tasks.unshift(tmp);
      if (isDemo()) return;
      mutate(() => api('addTask', { title }))
        .then(({ task }) => { Object.assign(tmp, task, { pending: false }); renderTasks(); })
        .catch(() => {
          state.tasks = state.tasks.filter((x) => x !== tmp);
          renderTasks();
          showToast(`Couldn’t add “${title}” — check your connection`);
        });
    });
    if (isDemo()) demoTasks.save(state.tasks);
    renderTasks();
  }

  $('tasks').addEventListener('click', (e) => {
    const li = e.target.closest('.task[data-id]');
    if (li) completeTask(li.dataset.id);
  });

  // Add sheet
  const addSheet = $('addSheet');
  $('addBtn').addEventListener('click', () => {
    $('addInput').value = '';
    addSheet.showModal();
    setTimeout(() => $('addInput').focus(), 50);
  });
  $('addCancel').addEventListener('click', () => addSheet.close());
  $('addForm').addEventListener('submit', (e) => {
    const v = $('addInput').value.trim();
    if (!v) { e.preventDefault(); return; }
    addTasks(v);
  });
  addSheet.addEventListener('click', (e) => { if (e.target === addSheet) addSheet.close(); });

  // Voice input, where the browser supports it (Chrome on Android does).
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) $('micBtn').hidden = true;
  else {
    let rec = null;
    $('micBtn').addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.onresult = (e) => {
        const text = Array.from(e.results).map((r) => r[0].transcript).join('');
        $('addInput').value = text.charAt(0).toUpperCase() + text.slice(1);
      };
      rec.onend = () => { rec = null; $('micBtn').classList.remove('listening'); };
      rec.onerror = rec.onend;
      $('micBtn').classList.add('listening');
      rec.start();
    });
  }

  // ─── Weather (Open-Meteo, no key needed) ───────────────────────────────────

  const WX = {
    0: ['Clear', 'sunny', 'clear_night'],
    1: ['Mostly clear', 'sunny', 'clear_night'],
    2: ['Partly cloudy', 'partly_cloudy_day', 'partly_cloudy_night'],
    3: ['Cloudy', 'cloud'],
    45: ['Fog', 'foggy'], 48: ['Freezing fog', 'foggy'],
    51: ['Light drizzle', 'rainy_light'], 53: ['Drizzle', 'rainy_light'], 55: ['Heavy drizzle', 'rainy'],
    56: ['Freezing drizzle', 'weather_mix'], 57: ['Freezing drizzle', 'weather_mix'],
    61: ['Light rain', 'rainy_light'], 63: ['Rain', 'rainy'], 65: ['Heavy rain', 'rainy_heavy'],
    66: ['Freezing rain', 'weather_mix'], 67: ['Freezing rain', 'weather_mix'],
    71: ['Light snow', 'weather_snowy'], 73: ['Snow', 'weather_snowy'], 75: ['Heavy snow', 'snowing_heavy'], 77: ['Snow grains', 'weather_snowy'],
    80: ['Showers', 'rainy_light'], 81: ['Showers', 'rainy'], 82: ['Heavy showers', 'rainy_heavy'],
    85: ['Snow showers', 'weather_snowy'], 86: ['Snow showers', 'snowing_heavy'],
    95: ['Thunderstorms', 'thunderstorm'], 96: ['Thunderstorms', 'thunderstorm'], 99: ['Thunderstorms', 'thunderstorm'],
  };
  const ICON_COLOR = {
    sunny: 'var(--yellow)', clear_night: '#c6cbf5',
    partly_cloudy_day: 'var(--yellow)', partly_cloudy_night: '#c6cbf5',
    cloud: '#dadce0', foggy: '#bdc1c6',
    rainy_light: 'var(--blue)', rainy: 'var(--blue)', rainy_heavy: 'var(--blue)',
    weather_mix: '#a8d1ff', weather_snowy: '#ffffff', snowing_heavy: '#ffffff', thunderstorm: 'var(--orange)',
  };
  const wxInfo = (code, isDay = true) => {
    const w = WX[code] || ['—', 'cloud'];
    const icon = !isDay && w[2] ? w[2] : w[1];
    return { label: w[0], icon, color: ICON_COLOR[icon] || 'var(--text)' };
  };
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
      setPeriod(new Date());
    } catch (err) {
      console.warn('Weather failed', err);
    }
  }

  function renderWeather() {
    const w = state.weather;
    if (!w) return;
    const c = w.current, d = w.daily;
    const now = wxInfo(c.weather_code, c.is_day);
    const icon = $('wxIcon');
    icon.textContent = now.icon;
    icon.style.color = now.color;
    $('wxTemp').textContent = Math.round(c.temperature_2m) + '°';
    $('wxCond').textContent = now.label;
    $('wxSub').innerHTML =
      `H ${Math.round(d.temperature_2m_max[0])}° · L ${Math.round(d.temperature_2m_min[0])}°<br>` +
      `Feels like ${Math.round(c.apparent_temperature)}°`;

    // Next six hours.
    const h = w.hourly;
    const i0 = h.time.findIndex((t) => new Date(t).getTime() > Date.now());
    $('wxHours').innerHTML = i0 < 0 ? '' : h.time.slice(i0, i0 + 6).map((t, j) => {
      const i = i0 + j, at = new Date(t);
      const info = wxInfo(h.weather_code[i], h.is_day ? h.is_day[i] : 1);
      const pop = h.precipitation_probability[i];
      return `<div class="wx-hour">
        <span class="h">${esc(shortHour(at))}</span>
        <span class="msr" style="color:${info.color}">${info.icon}</span>
        <span class="t">${Math.round(h.temperature_2m[i])}°</span>
        <span class="pop">${pop >= 30 ? pop + '%' : ''}</span>
      </div>`;
    }).join('');

    $('wxSummary').innerHTML = weatherSummary(w);

    $('wxDays').innerHTML = d.time.slice(1, 6).map((t, i) => {
      const k = i + 1;
      const info = wxInfo(d.weather_code[k]);
      const pop = d.precipitation_probability_max[k];
      return `<div class="wx-day">
        <span class="d">${esc(fmtDate(parseDate(t), { weekday: 'short' }))}</span>
        <span class="msr" style="color:${info.color}">${info.icon}</span>
        <span><span class="hi">${Math.round(d.temperature_2m_max[k])}°</span><span class="lo">${Math.round(d.temperature_2m_min[k])}°</span></span>
        <span class="pop">${pop >= 30 ? pop + '%' : ''}</span>
      </div>`;
    }).join('');
  }

  const shortHour = (d) => (cfg.clock === '24' ? timeParts(d).hm : `${d.getHours() % 12 || 12} ${d.getHours() < 12 ? 'AM' : 'PM'}`);

  // A plain-English line about rain in the next 12 hours.
  function weatherSummary(w) {
    const h = w.hourly;
    const nowMs = Date.now();
    let i0 = h.time.findIndex((t) => new Date(t).getTime() > nowMs - 3600000);
    if (i0 < 0) return '';
    const hours = [];
    for (let i = i0; i < Math.min(i0 + 12, h.time.length); i++) {
      hours.push({ t: new Date(h.time[i]), pop: h.precipitation_probability[i] ?? 0, code: h.weather_code[i] });
    }
    const wet = (x) => isWet(x.code) || x.pop >= 55;
    const kind = (code) => (code >= 95 ? 'Storms' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'Snow' : 'Rain');
    const at = shortHour;

    if (isWet({ code: w.current.weather_code, pop: 0 })) {
      const stop = hours.findIndex((x) => !wet(x));
      const k = kind(w.current.weather_code);
      return stop > 0
        ? `<span class="msr">rainy</span>${k} easing around ${at(hours[stop].t)}`
        : `<span class="msr">rainy</span>${k} continuing for a while — grab an umbrella`;
    }
    const first = hours.find(wet);
    if (first) {
      return `<span class="msr">rainy</span>${kind(first.code)} likely around ${at(first.t)} (${first.pop}%)`;
    }
    const end = new Date(nowMs).getHours() >= 15 ? 'tonight' : 'today';
    return `<span class="msr" style="color:var(--green)">check_circle</span>No rain expected ${end}`;
  }

  // ─── Photos ────────────────────────────────────────────────────────────────

  let photoFront = 'photoA';
  let photoTimer = null;
  async function nextPhoto() {
    clearTimeout(photoTimer);
    photoTimer = setTimeout(nextPhoto, Number(cfg.photoMinutes) * 60000);
    if (isDemo() || !state.photosEnabled || isNight()) return;
    try {
      const { dataUrl } = await api('photo');
      await new Promise((ok, fail) => { const img = new Image(); img.onload = ok; img.onerror = fail; img.src = dataUrl; });
      const back = photoFront === 'photoA' ? 'photoB' : 'photoA';
      const el = $(back);
      el.style.backgroundImage = `url("${dataUrl}")`;
      el.classList.remove('show');
      void el.offsetWidth; // restart the slow zoom
      el.classList.add('show');
      $(photoFront).classList.remove('show');
      const old = $(photoFront);
      setTimeout(() => { if (!old.classList.contains('show')) old.style.backgroundImage = ''; }, 3000);
      photoFront = back;
      document.body.classList.add('has-photo');
    } catch (err) {
      console.warn('Photo failed', err);
    }
  }

  // ─── Night mode ────────────────────────────────────────────────────────────

  const minutesOf = (hhmm) => { const [h, m] = (hhmm || '0:0').split(':').map(Number); return h * 60 + m; };
  function isNight(now = new Date()) {
    if (cfg.nightEnabled !== '1') return false;
    const m = now.getHours() * 60 + now.getMinutes();
    const s = minutesOf(cfg.nightStart), e = minutesOf(cfg.nightEnd);
    return s <= e ? m >= s && m < e : m >= s || m < e;
  }

  function updateNight(now = new Date()) {
    const night = $('night');
    const on = isNight(now) && Date.now() > state.nightDismissedUntil;
    if (night.hidden === !on) {
      if (on) renderNight(now);
      return;
    }
    night.hidden = !on;
    if (on) renderNight(now);
  }

  function renderNight(now) {
    const { hm, ap } = timeParts(now);
    $('nightTime').innerHTML = `${hm}${ap ? `<span class="ampm">${ap}</span>` : ''}`;
    $('nightDate').textContent = fmtDate(now, { weekday: 'long', month: 'long', day: 'numeric' });

    const upcoming = state.events.map(normalizeEvent)
      .filter((ev) => !ev.allDay && ev.s > now)
      .sort((a, b) => a.s - b.s)[0];
    if (upcoming) {
      const sameDay = startOfDay(upcoming.s).getTime() === startOfDay(now).getTime();
      const tomorrow = startOfDay(upcoming.s).getTime() === addDays(startOfDay(now), 1).getTime();
      const day = sameDay ? '' : tomorrow ? 'Tomorrow ' : fmtDate(upcoming.s, { weekday: 'long' }) + ' ';
      $('nightNext').innerHTML = `Next: <b>${esc(upcoming.title)}</b> · ${day}${fmtTime(upcoming.s)}`;
    } else {
      $('nightNext').textContent = '';
    }
    // Drift a little so nothing sits in the same spot all night.
    const dx = (Math.sin(now.getMinutes() / 9) * 3).toFixed(2), dy = (Math.cos(now.getMinutes() / 7) * 3).toFixed(2);
    $('nightInner').style.transform = `translate(${dx}rem, ${dy}rem)`;
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
    if (isDemo()) {
      el.innerHTML = '<span class="dot"></span>Showing sample data — tap the gear to connect your Google account';
    } else if (state.syncError) {
      el.classList.add('error');
      const when = state.lastSync ? ` · last updated ${fmtTime(state.lastSync)}` : '';
      el.innerHTML = `<span class="dot"></span>Can’t reach Google right now${when}`;
    } else {
      el.innerHTML = '';
    }
  }

  // ─── Toast ─────────────────────────────────────────────────────────────────

  let toastTimer = null;
  function showToast(msg, actionLabel, onAction) {
    const el = $('toast');
    el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
    if (actionLabel) {
      el.querySelector('button').onclick = () => { el.classList.remove('show'); onAction(); };
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
  }

  // ─── Settings sheet ────────────────────────────────────────────────────────

  const settingsSheet = $('settingsSheet');
  const form = $('settingsForm');
  let draftLoc = null;

  function openSettings() {
    for (const el of form.elements) if (el.name && el.name in cfg) el.value = cfg[el.name] ?? '';
    draftLoc = cfg.lat != null ? { lat: cfg.lat, lon: cfg.lon, place: cfg.place } : null;
    $('locCurrent').textContent = draftLoc ? `✓ ${draftLoc.place}` : 'No location set';
    $('locResults').innerHTML = '';
    $('testResult').textContent = '';
    settingsSheet.showModal();
  }
  $('gearBtn').addEventListener('click', openSettings);
  $('settingsCancel').addEventListener('click', () => settingsSheet.close());

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
      const u = `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name=${encodeURIComponent(q)}`;
      const { results = [] } = await (await fetch(u)).json();
      if (!results.length) { $('locResults').textContent = 'No matches.'; return; }
      $('locResults').innerHTML = '';
      results.forEach((r) => {
        const place = [r.name, r.admin1, r.country_code].filter(Boolean).join(', ');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = place;
        b.onclick = () => setDraftLoc({ lat: r.latitude, lon: r.longitude, place });
        $('locResults').appendChild(b);
      });
    } catch (_) {
      $('locResults').textContent = 'Search failed.';
    }
  });
  $('locSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('locFind').click(); } });

  $('locGps').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    $('locCurrent').textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
      (p) => setDraftLoc({ lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), place: 'Current location' }),
      () => { $('locCurrent').textContent = 'Couldn’t get your location — try searching instead.'; },
      { timeout: 15000 }
    );
  });

  $('settingsTest').addEventListener('click', async () => {
    const out = $('testResult');
    const url = form.elements.backendUrl.value.trim();
    if (!url) { out.textContent = 'Enter the backend URL first.'; return; }
    out.textContent = 'Testing…';
    const saved = { ...cfg };
    cfg.backendUrl = url;
    cfg.secret = form.elements.secret.value.trim();
    try {
      const d = await api('dashboard');
      out.textContent = `✓ Connected — ${d.events.length} events, ${d.tasks.length} to-dos`;
    } catch (err) {
      out.textContent = `✗ ${err.message === 'unauthorized' ? 'Secret key doesn’t match' : err.message}`;
    } finally {
      cfg = saved;
    }
  });

  form.addEventListener('submit', () => {
    for (const el of form.elements) if (el.name && el.name in cfg) cfg[el.name] = el.value.trim();
    if (draftLoc) Object.assign(cfg, draftLoc);
    saveSettings();
    state.nightDismissedUntil = 0;
    state.photosEnabled = false;
    document.body.classList.remove('has-photo');
    lastMinute = -1;
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
    const C = { family: '#33b679', mom: '#7986cb', dad: '#039be5', kids: '#f4511e', home: '#f6bf26' };
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
    key: 'kitchen-dashboard-demo-tasks',
    initial: ['Paper towels', 'Oat milk', 'Call HVAC about the filter', 'Return library books', 'Replace smoke detector battery', 'Book haircuts'],
    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(this.key));
        if (Array.isArray(saved)) return saved;
      } catch (_) {}
      return this.initial.map((title, i) => ({ id: 'demo-' + i, title }));
    },
    save(tasks) {
      try { localStorage.setItem(this.key, JSON.stringify(tasks.map(({ id, title }) => ({ id, title })))); } catch (_) {}
    },
  };

  // ─── Keep the screen awake ─────────────────────────────────────────────────

  async function keepAwake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { keepAwake(); refreshData(); refreshWeather(); }
  });

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
        }, () => {}, { timeout: 15000 });
      }
    }
    tick();
    refreshData();
    refreshWeather();
    keepAwake();
    setInterval(refreshData, REFRESH_DATA_MS);
    setInterval(refreshWeather, REFRESH_WEATHER_MS);
    photoTimer = setTimeout(nextPhoto, 3000);
  }

  boot();
})();
