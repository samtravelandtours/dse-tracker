# DhakaBoard — Live DSE Market Tracker

A stocknow/amarstock-style tracker for the **Dhaka Stock Exchange**: live prices,
DSEX/DS30/DSES index chart, top gainers/losers, most-traded list, symbol
search, and a per-browser watchlist.

There's no official DSE API, so the backend scrapes dsebd.org the same way
the well-established [`bdshare`](https://github.com/rochi88/bdshare) Python
library does — same pages, same table structure, same column mapping —
just re-implemented in Node so the whole stack is one JS codebase.

## ⚠️ Important — read before you run this

This was built and syntax-checked in a sandboxed environment whose network
**blocks dsebd.org outright** (`host_not_allowed`), so I could not verify the
scrape against the live site end-to-end. The parsing logic is a direct port
of bdshare's current, working selectors (I extracted and read its source to
get these exactly right), but DSE's markup does shift occasionally and you
may need to tweak `server/src/dseClient.js` if a table class or column count
has changed. If a route returns a 502, check the `detail` field in the JSON
response — it tells you which page failed and why.

Also worth knowing:
- **This scrapes a third-party website.** Keep request volume low (the
  built-in cache already limits this to one fetch per ~30s regardless of
  how many users hit your server) and check dsebd.org's terms before
  running this in production or at scale.
- Prices lag the live trading floor slightly and this is **not** investment
  advice — it's a personal tracking tool.

## Project structure

```
dse-tracker/
├── server/                 # Express API + static file host
│   ├── index.js            # entry point
│   ├── src/
│   │   ├── dseClient.js    # scrapes dsebd.org (axios + cheerio)
│   │   ├── routes.js       # /api/* endpoints
│   │   └── cache.js        # in-memory TTL cache + de-duped fetches
│   ├── package.json
│   └── .env.example
└── public/                 # plain HTML/CSS/JS frontend (no build step)
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Run it locally

```bash
cd server
npm install
cp .env.example .env      # adjust if needed
npm start                  # http://localhost:4000
```

Open `http://localhost:4000` — the Express server serves both the API and
the frontend from one port, so there's nothing else to configure.

For development with auto-restart on file changes:
```bash
npm run dev
```

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /api/status` | Current market status (Open/Closed) |
| `GET /api/market-info` | Last ~30 sessions: DSEX/DS30/DSES/DGEN + volumes (chart + snapshot) |
| `GET /api/stocks` | All symbols, live LTP/high/low/change/volume/value. `?q=ACI` filters by symbol |
| `GET /api/stocks/:symbol` | Single symbol snapshot |
| `GET /api/movers/gainers?limit=10` | Top gainers by % change |
| `GET /api/movers/losers?limit=10` | Top losers by % change |
| `GET /api/movers/most-traded?limit=10&by=volume\|value` | Most active symbols |
| `GET /api/historical?code=ACI&start=2026-06-01&end=2026-07-01` | Day-end OHLCV history for a symbol (or `code=All Instrument`) |

All routes are cached server-side (30s for live prices, 5 min for index
history, 30 min for historical queries) so refreshing the page or having
many visitors doesn't multiply requests to dsebd.org.

## Deploying

Any Node host works (Render, Railway, Fly.io, a VPS, etc.) since it's a
single Express process serving both API and static files:

```bash
cd server
npm install --production
node index.js
```

Set `PORT` via environment variable if your host requires a specific one.
Put it behind HTTPS (most hosts do this for you) — no other config needed.

## Extending

- **Portfolio/holdings, not just a watchlist**: the watchlist currently
  lives in `localStorage` (no login required). To track actual holdings
  (buy price, quantity, P&L) you'd want a small database (SQLite is enough)
  and basic auth — happy to add this if you want it.
- **Candlestick charts per stock**: `/api/historical` already returns full
  OHLCV, so a stock detail page with a candlestick chart (e.g. via
  lightweight-charts) is a natural next step.
- **Push/WebSocket updates**: currently the frontend polls every 30s; a
  WebSocket layer would make it feel more "live" without hammering dsebd.org
  more often.


<!-- https://dse-tracker-w9tz.onrender.com/ -->

Check Live Website
https://dse-tracker-w9tz.onrender.com/
