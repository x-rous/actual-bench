---
title: Actual Bench Demo
emoji: 💸
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Actual Bench public demo

This Space runs the demo-only Next.js server, Actual Server, and actual-http-api
in one container. Next.js listens on port 7860; the other services listen inside
the container. It serves two equivalent fictional household budgets, **Live Demo
- Envelope** and **Live Demo - Tracking**. Visitors share their changes until a
container restart; do not use real financial information.

Each image contains matching Actual budget seeds and a Bench metadata seed.
Startup replaces both working copies before starting the services. The SQLite
seed is generated during the image build from `seed-manifest.json` through the
application's own repositories; the generated app database is not committed.
Never mount a real data directory into this demo container: startup deletes
`/data`.

## Generate both seeds

From the repository root, with Node 24 and npm:

```bash
npm ci
npm install --no-save --no-package-lock @actual-app/sync-server@26.10.0
node demo/generate-seed.mjs
```

The generator uses a temporary local Actual Server (port 5006 by default;
`SEED_PORT` overrides it), produces twelve completed months and the current
partial month, validates equivalent transactions and expense plans, and keeps
the two stable Sync IDs. `SEED_PASSWORD` changes the generated server password;
its default is printed by the generator. Generation writes the Actual server
files to `demo/seed-data/` and the matching fictional references to
`demo/seed-manifest.json`. It also makes an ignored local `demo/seed-bench.sqlite`
for validation. The image independently regenerates that SQLite file from the
manifest. Commit the seed-data and manifest together when reviewing a refresh.

The household has a property and car with valuation history, linked mortgage and
car loans with principal transfers and interest expenses, a card with two saved
statements, and a completed checking reconciliation. Dates advance when seeds
are regenerated. Visitors may change the shared sample until reset.

## Build and test locally

From the repository root:

```bash
docker build -f demo/Dockerfile -t actual-bench-demo .
bash demo/smoke.sh
```

The smoke test uses the generated seed's default server password and a temporary
API key. If the seed was generated with `SEED_PASSWORD`, use that password in a
local container test instead. The test starts under 2 CPU / 16 GB limits,
checks both budgets and all four module metadata sets, changes both stores,
restarts the container, and checks again. It removes its test container. CI also
runs `demo/browser-smoke.cjs` in Chromium against the container.

## Deploy and reset

See `docs/DEMO_DEPLOYMENT.md` in the repository for the full preparation,
Space settings, Vercel redirect, and verification instructions. A Space restart
restores both seeds. Do not change the existing public Space until the reviewed
image has passed the checks.
