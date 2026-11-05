// News (Skreen+): a few current headlines, written on the Skreen relay (worker/news.js). They come through the relay,
// which sets the identifying User-Agent Wikimedia asks for and caches it.
const News = (() => {
  let list = [], at = 0;
  async function stories(force = false) {
    if (!force && list.length && Date.now() - at < 25 * 60000) return list;
    const res = await fetch(`${Weather.relay}/news`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    list = (await res.json()).stories || [];
    at = Date.now();
    return list;
  }
  return { stories, get current() { return list; } };
})();
