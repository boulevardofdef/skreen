// News (Skreen+): the "In the news" box from Wikipedia's front page, a few current stories.
// Wikipedia text is CC BY-SA, so the widget carries a credit. It comes through the Skreen relay,
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
