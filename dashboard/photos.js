// Photos (Skreen+): a slideshow of either
//   • "My photos": pictures chosen with Android's own photo picker (which includes Google Photos) and
//     kept, shrunk, in the app's private storage on the tablet, or
//   • "Art gallery": public-domain paintings from Wikimedia Commons, through the relay.
const Photos = (() => {
  const LOCAL = 'https://appassets.androidplatform.net/skreen-photos/';

  const nativeOK = () => !!(window.SkreenNative && window.SkreenNative.pickPhotos);

  // Commons often has no artist, and says "Unknown author", sometimes twice run together. Drop that.
  const clean = (s) => String(s || '').replace(/\b(unknown|anonymous)\s*(author|artist)s?/gi, '').replace(/\s+/g, ' ').trim();

  async function art() {
    const res = await fetch(`${Weather.relay}/art?v=2`, { cache: 'no-cache' });   // v=2: skip the old list the tablet may have kept
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return ((await res.json()).items || []).map((a) => ({ url: a.image, caption: [a.title, clean(a.artist)].filter(Boolean).join(' · '), art: true }));
  }

  function mine() {
    try { return JSON.parse(window.SkreenNative.listPhotos()).map((n) => ({ url: LOCAL + encodeURIComponent(n), caption: '', art: false })); } catch (_) { return []; }
  }

  // A shuffled order that shows every picture before repeating any.
  function shuffled(items) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  return { nativeOK, art, mine, shuffled, count: () => (nativeOK() ? mine().length : 0), pick: () => window.SkreenNative.pickPhotos(), clear: () => window.SkreenNative.clearPhotos() };
})();
