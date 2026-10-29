# Skreen weather proxy

A tiny Cloudflare Worker (free tier) in front of MET Norway's forecast API. It adds the identifying
`User-Agent` MET requires, caches for 15 minutes, and allows only the one forecast endpoint.

1. `CONTACT` in `index.js` already carries the contact email MET asks for.
2. `npm i -g wrangler && wrangler login && wrangler deploy` from this folder.
3. Put the printed `https://skreen-weather.<you>.workers.dev` address into `PROXY` at the top of
   `dashboard/weather.js`, commit, and the site starts using it.
4. Credit MET Norway wherever the weather appears (their terms ask for attribution; the privacy page and Settings carry it).

## Headlines (`news.js`)

Every 30 minutes a cron trigger reads Wikipedia's Current events pages (today and yesterday, UTC), asks a Claude
model for short AP-style headlines, and keeps them in one KV entry (`NEWS`). `/news` serves them; until there are
some, or if they go stale, it falls back to Wikipedia's "In the news" box.

One-time setup, from this folder:
1. `wrangler kv namespace create NEWS`, then paste the printed `id` into `wrangler.toml`.
2. `wrangler secret put ANTHROPIC_API_KEY` and paste an Anthropic API key.
3. `wrangler deploy`.
