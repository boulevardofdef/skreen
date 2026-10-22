// Weather providers. Both return the same shape (Open-Meteo's forecast JSON),
// so the rest of the app doesn't care which one answered.
//
//   MET Norway (api.met.no): free, including for commercial products, but its terms
//   require an identifying User-Agent, which browsers can't set. Point PROXY at the
//   Cloudflare Worker in /worker (it adds the header and caches) to switch it on.
//   Open-Meteo: used until then, and as the fallback. Free for non-commercial use only.
const Weather = (() => {
  const PROXY = 'https://skreen-weather.tiszenkel.workers.dev';
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const isoHour = (d) => `${iso(d)}T${String(d.getHours()).padStart(2, '0')}:00`;

  async function openMeteo(lat, lon, units) {
    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.search = new URLSearchParams({
      latitude: lat, longitude: lon,
      current: 'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m',
      hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
      temperature_unit: units,
      wind_speed_unit: units === 'fahrenheit' ? 'mph' : 'kmh',
      timezone: 'auto',
      forecast_days: 6,
    });
    const res = await fetch(u);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { ...(await res.json()), provider: 'openmeteo' };
  }

  // MET symbol names → the WMO codes the icons use.
  const SYMBOLS = [
    [/thunder/, 95], [/heavysnow/, 75], [/snow/, 73], [/lightsnow/, 71], [/sleet/, 67],
    [/heavyrain/, 65], [/lightrain/, 61], [/rainshowers/, 80], [/rain/, 63],
    [/fog/, 45], [/partlycloudy/, 2], [/cloudy/, 3], [/fair/, 1], [/clearsky/, 0],
  ];
  function wmo(symbol = '') {
    const s = symbol.replace(/_(day|night|polartwilight)$/, '');
    if (s === 'lightsnow' || s === 'lightsnowshowers') return 71;
    for (const [re, code] of SYMBOLS) if (re.test(s)) return code;
    return 3;
  }
  // Rain and cloud symbols carry no day/night suffix, so fall back to the clock.
  function isDay(sym, date) {
    if (sym.endsWith('_night')) return 0;
    if (sym.endsWith('_day')) return 1;
    const h = date.getHours();
    return h >= 6 && h < 19 ? 1 : 0;
  }
  const severity = (c) => (c >= 95 ? 5 : c >= 61 ? 4 : c >= 45 ? 3 : c === 3 ? 2 : c);

  // MET gives no "feels like", so work it out the standard way (NWS wind chill and heat index).
  function feelsLikeC(c, ms, rh) {
    const f = c * 9 / 5 + 32, mph = ms * 2.237;
    let out = f;
    if (f <= 50 && mph > 3) {
      const v = Math.pow(mph, 0.16);
      out = 35.74 + 0.6215 * f - 35.75 * v + 0.4275 * f * v;
    } else if (f >= 80 && rh >= 40) {
      out = -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh - 0.00683783 * f * f
        - 0.05481717 * rh * rh + 0.00122874 * f * f * rh + 0.00085282 * f * rh * rh - 0.00000199 * f * f * rh * rh;
    }
    return (out - 32) * 5 / 9;
  }

  // The forecast only looks forward, so remember today's extremes seen so far (on this device).
  function rememberToday(dayKey, hiC, loC) {
    let rec = { day: dayKey, hi: hiC, lo: loC };
    try {
      const old = JSON.parse(localStorage.getItem('skreen-wx-day') || 'null');
      if (old && old.day === dayKey) rec = { day: dayKey, hi: Math.max(old.hi, hiC), lo: Math.min(old.lo, loC) };
      localStorage.setItem('skreen-wx-day', JSON.stringify(rec));
    } catch (_) {}
    return rec;
  }

  async function met(lat, lon, units) {
    const base = PROXY || 'https://api.met.no';
    const res = await fetch(`${base}/weatherapi/locationforecast/2.0/complete?lat=${(+lat).toFixed(3)}&lon=${(+lon).toFixed(3)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ts = (await res.json()).properties.timeseries;
    const F = units === 'fahrenheit';
    const conv = (c) => (F ? c * 9 / 5 + 32 : c);
    const temp = (c) => Math.round(conv(c) * 10) / 10;
    const wind = (ms) => Math.round(F ? ms * 2.237 : ms * 3.6);

    const hourly = { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], is_day: [] };
    const rawC = [];
    for (const p of ts) {
      const next = p.data.next_1_hours;
      if (!next) continue;
      const sym = next.summary.symbol_code, pop = next.details && next.details.probability_of_precipitation;
      const c = p.data.instant.details.air_temperature;
      hourly.time.push(isoHour(new Date(p.time)));
      hourly.temperature_2m.push(temp(c));
      rawC.push(c);
      hourly.precipitation_probability.push(pop == null ? null : Math.round(pop));
      hourly.weather_code.push(wmo(sym));
      hourly.is_day.push(isDay(sym, new Date(p.time)));
    }

    const first = ts[0].data, d0 = first.instant.details;
    const symNow = (first.next_1_hours || first.next_6_hours).summary.symbol_code;
    const current = {
      temperature_2m: temp(d0.air_temperature),
      apparent_temperature: temp(feelsLikeC(d0.air_temperature, d0.wind_speed || 0, d0.relative_humidity || 50)),
      weather_code: wmo(symNow), is_day: isDay(symNow, new Date()),
      relative_humidity_2m: d0.relative_humidity, wind_speed_10m: wind(d0.wind_speed),
    };

    // Per-day extremes (in °C): hourly points where we have them, widened by the 6-hour blocks' own max/min.
    const days = new Map();
    const day = (k) => { if (!days.has(k)) days.set(k, { hi: -Infinity, lo: Infinity, pop: null, codes: [], six: [] }); return days.get(k); };
    hourly.time.forEach((t, i) => {
      const d = day(t.slice(0, 10));
      d.hi = Math.max(d.hi, rawC[i]); d.lo = Math.min(d.lo, rawC[i]);
      const p = hourly.precipitation_probability[i];
      if (p != null) d.pop = Math.max(d.pop ?? 0, p);
      const h = +t.slice(11, 13);
      if (h >= 7 && h <= 21) d.codes.push(hourly.weather_code[i]);
    });
    for (const p of ts) {
      const n = p.data.next_6_hours;
      if (!n) continue;
      const d = day(isoHour(new Date(p.time)).slice(0, 10)), det = n.details || {};
      const hi = det.air_temperature_max != null ? det.air_temperature_max : p.data.instant.details.air_temperature;
      const lo = det.air_temperature_min != null ? det.air_temperature_min : p.data.instant.details.air_temperature;
      d.hi = Math.max(d.hi, hi); d.lo = Math.min(d.lo, lo);
      d.six.push(wmo(n.summary.symbol_code));
      if (det.probability_of_precipitation != null) d.pop = Math.max(d.pop ?? 0, det.probability_of_precipitation);
    }
    const keys = [...days.keys()].sort().slice(0, 6);
    const today = keys[0];
    const mem = rememberToday(today, days.get(today).hi, days.get(today).lo);
    days.get(today).hi = mem.hi; days.get(today).lo = mem.lo;

    const daily = { time: keys, weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [] };
    for (const k of keys) {
      const d = days.get(k), codes = d.codes.length ? d.codes : d.six;
      daily.temperature_2m_max.push(Math.round(conv(d.hi))); daily.temperature_2m_min.push(Math.round(conv(d.lo)));
      daily.precipitation_probability_max.push(d.pop);
      daily.weather_code.push(codes.length ? codes.reduce((a, b) => (severity(b) > severity(a) ? b : a)) : 3);
    }
    return { current, hourly, daily, provider: 'met' };
  }

  // TEST TOGGLE (remove before launch): tap the temperature to force one provider.
  const TEST_KEY = 'skreen-wx-test';
  const testGet = () => { try { return localStorage.getItem(TEST_KEY) || ''; } catch (_) { return ''; } };
  function testCycle(current) {
    const next = current === 'met' ? 'openmeteo' : 'met';
    try { localStorage.setItem(TEST_KEY, next); } catch (_) {}
    return next;
  }

  async function forecast(lat, lon, units) {
    const forced = testGet();
    if (forced === 'met') return met(lat, lon, units);
    if (forced === 'openmeteo') return openMeteo(lat, lon, units);
    if (PROXY) {
      try { return await met(lat, lon, units); } catch (e) { console.warn('MET weather failed, falling back', e); }
    }
    return openMeteo(lat, lon, units);
  }

  return { forecast, met, openMeteo, wmo, testCycle };
})();
