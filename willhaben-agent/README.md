# willhaben agent

A self-hosted search agent for **willhaben.at** that checks your saved searches every
30–60 seconds and pushes a notification the moment a new advert appears — instead of
whenever willhaben's own Suchagent gets around to it.

It polls the search pages you already built in your browser, remembers every advert it has
seen, and notifies you about the difference. Notifications go to your phone and desktop via
**Web Push**, **Telegram**, or any **webhook** (ntfy.sh and friends).

```
  ┌──────────────┐   every 60s    ┌──────────────┐   new ids only   ┌──────────────┐
  │ willhaben.at │ ─────────────► │  the agent   │ ───────────────► │ your phone   │
  │ search page  │   page 1 only  │  (this app)  │   push/telegram  │ your desktop │
  └──────────────┘                └──────────────┘                  └──────────────┘
```

---

## Quick start

```bash
cd willhaben-agent
npm install
npm start
```

Open <http://localhost:8787>, click **+ Search**, and paste a willhaben search URL.

That's it — the first check "arms" the search by memorising everything currently on page 1
without notifying you. From then on, anything new gets pushed within one polling interval.

### Getting a search URL

Build the search on willhaben.at in your browser: pick the category, set the price band,
the location radius, the keywords — everything. Then copy the address bar and paste it in.

The agent rewrites it slightly: it forces `sort=1` (newest first) and strips any `page`
parameter, because new adverts only ever land on page 1 of a newest-first list. If you
already picked a sort yourself, yours is kept.

---

## Notifications

| Channel | Works on | Setup |
|---|---|---|
| **Web Push** | Desktop Chrome/Edge/Firefox/Safari, Android, iOS 16.4+ | Click *Enable notifications*. Needs HTTPS (or localhost). |
| **Telegram** | Everything | Settings → Telegram. Most reliable option on a phone. |
| **Webhook** | Everything | Settings → Webhook. Point at an `ntfy.sh` topic in *text* mode, or your own endpoint in *JSON* mode. |

All enabled channels fire for every find, so you can run belt and braces.

**On iPhone**, web push only works if you first **Add to Home Screen** and open the app from
that icon — Safari tabs get no push, ever. If that's a hassle, use Telegram.

**Web push needs a secure context.** `http://localhost` counts as secure, so push works when
you run this on your own laptop. Reaching it from your phone over plain `http://192.168.x.x`
does not — you need HTTPS, which the deployment options below give you.

### Telegram in 60 seconds

1. Message `@BotFather`, send `/newbot`, copy the token.
2. Send your new bot any message.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `result[0].message.chat.id`.
4. Paste both into Settings → Telegram.

---

## Filters

The willhaben query does the heavy lifting; these narrow it further, after the fetch:

- **Min / max price** — adverts with no price ("Preis auf Anfrage") are *never* dropped by a
  price range. Better a false positive than missing the one you wanted.
- **Title must contain any of** — an OR list. `carbon, ultegra` matches either.
- **Skip if it contains** — an exclude list, which wins over the include list.
- **Seller** — private or dealer. Adverts where willhaben doesn't say are let through.

Include/exclude match against the title *and* the teaser text, case-insensitively.

Filtered-out adverts still get marked as seen, so they cannot come back and notify you later.

---

## Deployment

Push notifications need HTTPS and a machine that stays awake. Pick whichever is least effort:

### Docker

```bash
docker build -t willhaben-agent .
docker run -d --restart unless-stopped \
  -p 8787:8787 \
  -v "$PWD/data:/app/data" \
  -e AGENT_TOKEN=pick-a-long-random-string \
  --name willhaben-agent willhaben-agent
```

Put it behind Caddy or any reverse proxy that terminates TLS:

```
agent.example.com {
    reverse_proxy localhost:8787
}
```

### Fly.io / Render / Railway

Any host that runs a Node process and gives you an HTTPS URL works. Two things matter:

- Mount a **persistent volume at `/app/data`** — that's where the searches, the seen-advert
  memory, and the VAPID keys live. On ephemeral storage every restart re-arms your searches
  and logs out every device.
- Set **`AGENT_TOKEN`**, because the URL is public.

### Tailscale

The zero-config option: run it on any always-on machine at home and reach it at
`https://machine.tailnet.ts.net` from your phone. You get HTTPS (so push works) without
exposing anything to the internet.

---

## Configuration

Everything is optional; the defaults work.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Where `db.json` and `vapid.json` live |
| `AGENT_TOKEN` | *(empty)* | Shared password. **Set this before exposing the app.** Empty means no auth. |
| `POLL_INTERVAL_SEC` | `60` | Default interval for new searches |
| `MIN_POLL_INTERVAL_SEC` | `20` | Floor the UI cannot go below |
| `MIN_REQUEST_SPACING_MS` | `2500` | Minimum gap between any two outbound requests |
| `REQUEST_TIMEOUT_MS` | `20000` | Fetch timeout |
| `SEEN_CAP` | `3000` | Adverts remembered per search |
| `MAX_NOTIFICATIONS_PER_POLL` | `5` | Above this, one summary notification instead of a burst |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | *(auto)* | Pin the push keys instead of using `data/vapid.json`. `npm run keys` generates a pair. |
| `VAPID_SUBJECT` | `mailto:agent@example.com` | Contact address sent to push services |

---

## How fast can I poll?

The floor is 20 seconds and the default is 60. Please leave it near the default.

This is one person's search hitting a public page once a minute — about the traffic of
leaving a tab open and refreshing it. Turning it into ten searches at 20-second intervals is
a different thing, and willhaben will notice: you'll start getting `429`s, the agent will
back off exponentially, and you'll end up slower than the Suchagent you were trying to beat.
Rate-limit responses are surfaced in the UI as a `blocked` status.

Fetches are spaced globally (`MIN_REQUEST_SPACING_MS`) and jittered, so ten searches never
turn into ten simultaneous requests.

This scrapes a site that offers no public API, for personal use. Check willhaben's terms if
you plan to do anything beyond watching your own searches.

---

## When a search stops finding things

```bash
npm run probe -- "https://www.willhaben.at/iad/kaufen-und-verkaufen/..."
```

It fetches the page once and prints what the parser saw: how many adverts, which parsing
strategy matched, and the first ten results. Add `--dump` to write the raw HTML into
`DATA_DIR` for a closer look.

| Probe says | Meaning |
|---|---|
| `kind: blocked` | Rate limited or hit a bot wall. Poll less often, wait a few minutes. |
| `kind: parse` | Willhaben changed their page shape. Re-run with `--dump`. |
| `parsed 0 adverts` | The query genuinely has no results — check it in a browser. |
| `mostly empty fields: …` | Willhaben renamed attributes. Matching still works (it keys on advert id); only the notification text gets thinner. |

### How the parsing works

Willhaben is a Next.js site, so every search page ships its full result set as JSON in a
`<script id="__NEXT_DATA__">` tag. That's what gets parsed — far more stable than scraping
the DOM, but the *shape* of that JSON has moved around over the years and differs per
vertical (marktplatz / immo / auto).

So there are two strategies. The known path
(`props.pageProps.searchResult.advertSummaryList.advertSummary`) is tried first; if it's
gone, the whole blob is walked for the largest array of advert-shaped objects. Attribute
lookups have aliases and every field degrades to `null` rather than throwing. The probe
output tells you which strategy matched.

**A caveat worth stating plainly:** the parser was built and tested against synthetic
fixtures of that JSON shape, not against a live capture — the machine it was written on
could not reach willhaben.at. The logic is covered by tests, but the first thing to do on
your own network is run `npm run probe` and confirm real adverts come back.

---

## Tests

```bash
npm test
```

29 tests covering the parser (both strategies, de-AT price formats, degraded adverts, bot
walls), the filters, and an end-to-end run of the polling loop against a local stand-in for
willhaben — seeding, exact-once detection, filter suppression, error recovery, and the
persistence round-trip.

---

## Notes

- **Deleting `data/vapid.json` logs out every subscribed device.** Back it up, or pin the
  keys via env vars.
- **Changing a search's URL re-arms it.** A different query returns a different result set,
  and you don't want a notification for all of it.
- The first check after adding a search is always silent, by design.
- Adverts are matched by willhaben's advert id, so an advert that falls off page 1 and comes
  back (bumped, edited) does not notify you twice.
