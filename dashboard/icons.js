/* Skreen icons: hand-drawn geometric line icons (square caps, mitred joins). */
window.Icons = (() => {
  const wrap = (inner, vb = 48) =>
    `<svg class="ico" viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${inner}</svg>`;

  const SUN = (cx, cy, r, rays = 8) => {
    let s = `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2, c = Math.cos(a), n = Math.sin(a);
      s += `<path d="M${(cx + c * (r + 5)).toFixed(1)} ${(cy + n * (r + 5)).toFixed(1)}L${(cx + c * (r + 9)).toFixed(1)} ${(cy + n * (r + 9)).toFixed(1)}"/>`;
    }
    return s;
  };
  const MOON = (x = 0, y = 0, k = 1) =>
    `<path transform="translate(${x} ${y}) scale(${k})" d="M30 8A18 18 0 1 0 40 32A14 14 0 0 1 30 8Z"/>`;
  const CLOUD = (y = 0, dx = 0) =>
    `<path transform="translate(${dx} ${y})" d="M13 36H34A8 8 0 0 0 34 20A11 11 0 0 0 13 23A7 7 0 0 0 13 36Z"/>`;
  const DROPS = (n, y0 = 38) =>
    Array.from({ length: n }, (_, i) => {
      const x = 14 + i * (20 / Math.max(1, n - 1 || 1)) + (n === 1 ? 10 : 0);
      return `<path d="M${x.toFixed(1)} ${y0}l-2 6"/>`;
    }).join('');

  const set = {
    sunny: wrap(SUN(24, 24, 8)),
    clear_night: wrap(MOON(4, 2)),
    partly_day: wrap(SUN(17, 16, 6) + `<path fill="#0e0d0b" d="M14 40H34A7 7 0 0 0 34 26A10 10 0 0 0 15 29A5.5 5.5 0 0 0 14 40Z"/>`),
    partly_night: wrap(MOON(0, -4, 0.6) + `<path fill="#0e0d0b" d="M14 40H34A7 7 0 0 0 34 26A10 10 0 0 0 15 29A5.5 5.5 0 0 0 14 40Z"/>`),
    cloud: wrap(CLOUD(4)),
    fog: wrap(`<path d="M8 14H40M12 22H36M8 30H40M14 38H34"/>`),
    drizzle: wrap(CLOUD(-4) + DROPS(2, 36)),
    rain: wrap(CLOUD(-4) + DROPS(3, 36)),
    heavy_rain: wrap(CLOUD(-6) + `<path d="M12 34l-3 8M21 34l-3 8M30 34l-3 8M39 34l-3 8"/>`),
    snow: wrap(CLOUD(-4) + `<path d="M15 38h.01M24 38h.01M33 38h.01M19.5 44h.01M28.5 44h.01" stroke-width="5"/>`),
    mix: wrap(CLOUD(-4) + `<path d="M14 36l-2 6M24 38h.01M32 36l-2 6M36 42h.01" stroke-width="3"/><path d="M24 38h.01" stroke-width="5"/>`),
    thunder: wrap(CLOUD(-6) + `<path d="M26 28l-6 9h7l-5 9"/>`),
    // UI glyphs
    pin: wrap(`<path d="M24 43C24 43 11 29 11 19A13 13 0 0 1 37 19C37 29 24 43 24 43Z"/><circle cx="24" cy="19" r="4.5"/>`),
    check: wrap(`<path d="M9 25l10 10L39 13" stroke-width="5"/>`),
    plus: wrap(`<path d="M24 8V40M8 24H40" stroke-width="4"/>`),
    mic: wrap(`<rect x="17" y="5" width="14" height="24"/><path d="M10 22v4a14 14 0 0 0 28 0v-4M24 40v5"/>`),
    music: wrap(`<path d="M19 36V11L38 7V32"/><circle cx="13" cy="36" r="6"/><circle cx="32" cy="32" r="6"/>`),
    play: wrap(`<path d="M14 8L38 24L14 40Z" fill="currentColor"/>`),
    pause: wrap(`<path d="M13 8H20V40H13ZM28 8H35V40H28Z" fill="currentColor"/>`),
    next: wrap(`<path d="M10 9L30 24L10 39ZM34 9H40V39H34Z" fill="currentColor"/>`),
    prev: wrap(`<path d="M38 9L18 24L38 39ZM14 9H8V39H14Z" fill="currentColor"/>`),
    timer: wrap(`<circle cx="24" cy="27" r="14"/><path d="M24 27V18M19 8H29M24 8V13"/>`),
    up: wrap(`<path d="M24 38V10M11 22L24 9L37 22"/>`),
    down: wrap(`<path d="M24 10V38M11 26L24 39L37 26"/>`),
    gear: wrap(`<path d="M6 12H42M6 24H42M6 36H42"/><rect x="28" y="7" width="8" height="10" fill="#0e0d0b"/><rect x="12" y="19" width="8" height="10" fill="#0e0d0b"/><rect x="26" y="31" width="8" height="10" fill="#0e0d0b"/>`),
    umbrella: wrap(`<path d="M5 24A19 19 0 0 1 43 24Z"/><path d="M24 24V40a4 4 0 0 1-8 0"/>`),
    close: wrap(`<path d="M10 10L38 38M38 10L10 38" stroke-width="4"/>`),
    copy: wrap(`<rect x="15" y="15" width="24" height="26"/><path d="M33 15V7H9V33H15"/>`),
    arrow: wrap(`<path d="M8 24H38M26 12L38 24L26 36"/>`),
  };

  // Open-Meteo WMO weather code → label + icon
  const WX = {
    0: ['Clear', 'sunny', 'clear_night'], 1: ['Mostly clear', 'sunny', 'clear_night'],
    2: ['Partly cloudy', 'partly_day', 'partly_night'], 3: ['Overcast', 'cloud'],
    45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'],
    51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'rain'],
    56: ['Freezing drizzle', 'mix'], 57: ['Freezing drizzle', 'mix'],
    61: ['Light rain', 'drizzle'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'heavy_rain'],
    66: ['Freezing rain', 'mix'], 67: ['Freezing rain', 'mix'],
    71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
    80: ['Showers', 'drizzle'], 81: ['Showers', 'rain'], 82: ['Heavy showers', 'heavy_rain'],
    85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'],
    95: ['Thunderstorms', 'thunder'], 96: ['Thunderstorms', 'thunder'], 99: ['Thunderstorms', 'thunder'],
  };
  const weather = (code, isDay = true) => {
    const w = WX[code] || ['—', 'cloud'];
    return { label: w[0], svg: set[!isDay && w[2] ? w[2] : w[1]] };
  };

  // The Skreen logo: one fixed mark + wordmark, shown on every screen except the main display.
  const lockup = '<img class="lockup" src="logo-lockup.png" alt="Skreen">';
  const logo = `<span class="brand-logo">${lockup}</span>`;

  const logoPlus = `<span class="brand-logo plus">${lockup}<svg class="plus-sign" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill="#e8c887"/></svg></span>`;

  return { ...set, weather, WX, logo, logoPlus };
})();
