# Tezos Baker Quiet Window Finder

Find the 5 calmest 3-minute slots in a Tezos baker's daily schedule — useful for planning maintenance windows, upgrades, or any downtime where missing attestations or block proposals should be minimised.

## How it works

1. Fetches all baking and attesting rights for a baker on a given date via the [TzKT API](https://api.tzkt.io)
2. Slides a 3-minute window (~30 blocks at 6s/block, post-Tallinn) across the full day
3. Scores each window: `score = attestations + 3 × block_proposals`
4. Returns the top 5 lowest-score windows, each separated by at least the configured outage time interval

## Features

- Times displayed in **local browser timezone** with seconds precision
- **Future date support** (up to 2 days ahead) — estimates block levels from current head
- Shows **starting block level** for each quiet window
- Configurable **outage time interval** (minimum gap between results)
- Counts attestation **slots** accurately (post-Tallinn)
- Default baker: Dulo Stakery (`tz1NZXxWG8bBL1YGzeLRfh2uia3JGkD4NcQ2`)

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

## Original prompt

> I want to build a tool that looks at Tezos baker rights (when the baker is scheduled to sign attestation or create a block) and produces the top 5 spots each 3 minutes long in a given day that show the longest period of time during which the baker has least activity. The application can call Tezos API to achieve that. It should come with simple front end interface that allows the user to give the date and specify minimum 1 hour window in which the tool will show the top 3 minute blocks with least activity for the baker. As an example this tool tzkt.io gives schedule.

## Credits

Built by [Dulo Stakery](https://dulostakery.com) ⚔️
