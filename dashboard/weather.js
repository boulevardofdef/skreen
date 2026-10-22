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
    return res.json();
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

  async function met(lat, lon, units) {
    const base = PROXY || 'https://api.met.no';
    const res = await fetch(`${base}/weatherapi/locationforecast/2.0/complete?lat=${(+lat).toFixed(3)}&lon=${(+lon).toFixed(3)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ts = (await res.json()).properties.timeseries;
    const F = units === 'fahrenheit';
    const temp = (c) => Math.round((F ? c * 9 / 5 + 32 : c) * 10) / 10;
    const wind = (ms) => Math.round(F ? ms * 2.237 : ms * 3.6);

    const hourly = { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], is_day: [] };
    for (const p of ts) {
      const next = p.data.next_1_hours;
      if (!next) continue;
      const sym = next.summary.symbol_code, pop = next.details && next.details.probability_of_precipitation;
      hourly.time.push(isoHour(new Date(p.time)));
      hourly.temperature_2m.push(temp(p.data.instant.details.air_temperature));
      hourly.precipitation_probability.push(pop == null ? null : Math.round(pop));
      hourly.weather_code.push(wmo(sym));
      hourly.is_day.push(isDay(sym, new Date(p.time)));
    }

    const first = ts[0].data, d0 = first.instant.details;
    const symNow = (first.next_1_hours || first.next_6_hours).summary.symbol_code;
    const current = {
      temperature_2m: temp(d0.air_temperature), apparent_temperature: temp(d0.air_temperature),
      weather_code: wmo(symNow), is_day: isDay(symNow, new Date()),
      relative_humidity_2m: d0.relative_humidity, wind_speed_10m: wind(d0.wind_speed),
    };

    const days = new Map();
    hourly.time.forEach((t, i) => {
      const k = t.slice(0, 10), day = days.get(k) || { hi: -Infinity, lo: Infinity, pop: null, codes: [] };
      day.hi = Math.max(day.hi, hourly.temperature_2m[i]); day.lo = Math.min(day.lo, hourly.temperature_2m[i]);
      const p = hourly.precipitation_probability[i];
      if (p != null) day.pop = Math.max(day.pop ?? 0, p);
      const h = +t.slice(11, 13);
      if (h >= 7 && h <= 21) day.codes.push(hourly.weather_code[i]);
      days.set(k, day);
    });
    const keys = [...days.keys()].slice(0, 6);
    const daily = { time: keys, weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [] };
    // The hourly series runs out after ~2.5 days, so fill later days from the 6-hourly points.
    const six = new Map();
    for (const p of ts) {
      const n = p.data.next_6_hours;
      if (!n) continue;
      const k = isoHour(new Date(p.time)).slice(0, 10), v = six.get(k) || { t: [], codes: [], pop: null };
      v.t.push(p.data.instant.details.air_temperature);
      v.codes.push(wmo(n.summary.symbol_code));
      const pp = n.details && n.details.probability_of_precipitation;
      if (pp != null) v.pop = Math.max(v.pop ?? 0, pp);
      six.set(k, v);
    }
    for (const t of [...six.keys()]) if (!keys.includes(t) && keys.length < 6) keys.push(t);
    keys.sort();
    for (const k of keys) {
      const day = days.get(k), s = six.get(k);
      if (day && day.codes.length) {
        daily.temperature_2m_max.push(Math.round(day.hi)); daily.temperature_2m_min.push(Math.round(day.lo));
        daily.precipitation_probability_max.push(day.pop);
        daily.weather_code.push(day.codes.reduce((a, b) => (severity(b) > severity(a) ? b : a)));
      } else if (s) {
        const all = s.t.map((c) => (F ? c * 9 / 5 + 32 : c));
        daily.temperature_2m_max.push(Math.round(Math.max(...all))); daily.temperature_2m_min.push(Math.round(Math.min(...all)));
        daily.precipitation_probability_max.push(s.pop);
        daily.weather_code.push(s.codes.reduce((a, b) => (severity(b) > severity(a) ? b : a)));
      } else {
        daily.temperature_2m_max.push(null); daily.temperature_2m_min.push(null);
        daily.precipitation_probability_max.push(null); daily.weather_code.push(3);
      }
    }
    daily.time = keys;
    return { current, hourly, daily, provider: 'met' };
  }

  async function forecast(lat, lon, units) {
    if (PROXY) {
      try { return await met(lat, lon, units); } catch (e) { console.warn('MET weather failed, falling back', e); }
    }
    return openMeteo(lat, lon, units);
  }

  return { forecast, met, openMeteo, wmo };
})();
