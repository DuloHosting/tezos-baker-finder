# Baker Quiet Window Finder by Dulo Stakery

Find the calmest slots in a Tezos baker's schedule for a given day — useful for planning maintenance windows, upgrades, or any downtime where missing attestations or block proposals should be minimized.

## How it works

1. Gets the current head block and its timestamp as an anchor point
2. Estimates block levels for the selected time range (today: now → midnight, future: midnight → midnight)
3. Fetches all baking and attesting rights for the baker via the [TzKT API](https://api.tzkt.io)
4. Slides a configurable outage window across the schedule and scores each position
5. **Block proposals are heavily penalized** — block-free windows are always preferred over windows with blocks
6. Returns the top N quietest windows, spread apart by the configured results gap

## Features

- **Configurable outage window** — set the duration of each quiet slot (default 3 minutes)
- **Configurable results gap** — minimum time between results so they're spread throughout the day (default 60 minutes)
- **Configurable top results** — choose how many quiet windows to show (default 5)
- **Local timezone display** — all times shown in your browser's timezone with seconds precision
- **Future date support** — today + 2 days ahead, using head block estimation
- **Smart time range** — for today, only analyzes from now until midnight; caps at last block with actual schedule data
- **Block-aware scoring** — any window without block proposals ranks above windows with blocks
- **Clickable block links** — each result links to the starting block on [tzkt.io](https://tzkt.io)
- **6-second block time** — updated for the Tallinn upgrade
- **Dark blue theme** — matching Dulo Stakery branding

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5173

## Build for production

```bash
npm run build
```

Output goes to `dist/` — ready to deploy anywhere (static hosting, S3, Cloudflare Pages, Vercel, etc.)

## Deploy as a service

```bash
# Build first
npm run build

# Create a systemd service to serve the static files
sudo cp tezos-baker-finder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tezos-baker-finder
```

## Tech stack

- React 18
- Vite
- TzKT public API (no API key required)

## Credits

Built by [Dulo Stakery](https://dulostakery.com) ⚔️ — a home Tezos baker running on own hardware since 2022.

- Baker address: [`tz1NZXxWG8bBL1YGzeLRfh2uia3JGkD4NcQ2`](https://tzkt.io/tz1NZXxWG8bBL1YGzeLRfh2uia3JGkD4NcQ2)
- Powered by [TezBake](https://docs.tez.capital/)
