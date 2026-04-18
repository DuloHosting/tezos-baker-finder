# Tezos Baker Quiet Window Finder

Find the 5 calmest 3-minute slots in a Tezos baker's daily schedule — useful for planning maintenance windows, upgrades, or any downtime where missing attestations or block proposals should be minimised.

## How it works

1. Fetches all baking and attesting rights for a baker on a given date via the [TzKT API](https://api.tzkt.io)
2. Slides a 3-minute window (~18 blocks at 10s/block) across the full day
3. Scores each window: `score = attestations + 3 × block_proposals`
4. Returns the top 5 lowest-score windows, each separated by at least the configured minimum gap

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

Output goes to `dist/` — ready to deploy to S3, Cloudflare Pages, Vercel, etc.

## Tech stack

- React 18
- Vite
- TzKT public API (no API key required)
