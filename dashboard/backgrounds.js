/* Skreen backgrounds: calm, dark, built-in. One per day, or pin your favorite. */
window.Backgrounds = (() => {
  const svg = (w, h, body) =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='xMidYMid slice'>${body}</svg>`)}")`;

  // Wavy topographic lines.
  const contours = (stroke, base, seed) => {
    let p = '';
    for (let i = 0; i < 26; i++) {
      let d = '';
      for (let x = 0; x <= 1600; x += 40) {
        const y = 60 + i * 36 + 38 * Math.sin(x / (210 + seed * 40) + i * 0.33 + seed) + 22 * Math.sin(x / 97 + i * 0.5);
        d += (x ? 'L' : 'M') + x + ' ' + y.toFixed(1);
      }
      p += `<path d='${d}'/>`;
    }
    return `${svg(1600, 1000, `<g fill='none' stroke='${stroke}' stroke-width='1.4'>${p}</g>`)} center/cover, ${base}`;
  };

  const rings = (stroke, base, cx, cy) => {
    let p = '';
    for (let r = 60; r < 1500; r += 70) p += `<circle cx='${cx}' cy='${cy}' r='${r}'/>`;
    return `${svg(1600, 1000, `<g fill='none' stroke='${stroke}' stroke-width='1.4'>${p}</g>`)} center/cover, ${base}`;
  };

  const list = [
    { id: 'ink', name: 'Ink', css: 'radial-gradient(120% 90% at 15% 0%, #211e1a 0%, #0e0d0b 62%)' },
    { id: 'contours', name: 'Contours', css: contours('rgba(243,238,227,0.11)', '#0f0e0c', 1) },
    { id: 'dusk', name: 'Dusk', css: 'radial-gradient(65% 75% at 88% 8%, rgba(86,58,92,0.55), transparent 70%), radial-gradient(70% 70% at 8% 100%, rgba(30,60,78,0.6), transparent 70%), #0e0d11' },
    { id: 'grid', name: 'Dot grid', css: 'radial-gradient(circle at 1px 1px, rgba(243,238,227,0.14) 1.3px, transparent 1.8px) 0 0 / 34px 34px, radial-gradient(90% 80% at 50% 40%, #1a1917, #0c0b0a)' },
    { id: 'moss', name: 'Moss', css: 'radial-gradient(85% 85% at 85% 100%, rgba(58,72,40,0.65), transparent 70%), radial-gradient(60% 60% at 0% 0%, rgba(40,52,34,0.5), transparent 70%), #0c0e0a' },
    { id: 'rings', name: 'Rings', css: rings('rgba(243,238,227,0.1)', '#0e0e10', 1250, 220) },
    { id: 'hatch', name: 'Hatch', css: 'repeating-linear-gradient(135deg, rgba(243,238,227,0.045) 0 1px, transparent 1px 15px), radial-gradient(90% 90% at 80% 0%, rgba(52,66,84,0.55), transparent 70%), #0d0f12' },
    { id: 'ember', name: 'Ember', css: 'radial-gradient(75% 85% at 0% 100%, rgba(128,52,28,0.6), transparent 70%), radial-gradient(50% 50% at 100% 0%, rgba(70,46,30,0.45), transparent 70%), #100c0a' },
    { id: 'waves', name: 'Waves', css: contours('rgba(150,190,210,0.12)', '#0c1013', 3) },
  ];

  const byId = (id) => list.find((b) => b.id === id);
  const dayIndex = (d = new Date()) => {
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000);
  };
  // "auto" rotates through the list, one per day.
  const forDay = (d) => list[dayIndex(d) % list.length];

  return { list, byId, forDay };
})();
