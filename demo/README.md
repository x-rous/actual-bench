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

The household has a family home with six years of valuations, a car, and an
investment property with linked rental income and expenses. Four loans include
the home and investment mortgages, a car loan, and a personal loan. Two cards
show a missed minimum payment with interest and a fully paid instalment plan.
The checking account has completed, in-review, and ready-to-apply reconciliation
examples. Prior Envelope months have zero To Budget. An illustrative USD/AUD rate
is included; it is not a live quote. Dates advance when seeds are regenerated.

A local destination and monthly automation demonstrate backing up Bench metadata
(not the Actual budget files) at 02:00 UTC on the first day of each month. The
first backup runs at startup so later monthly runs have a real scheduling baseline.
The folder is inside the shared demo container, so its files and run history are
removed on restart. The Space can sleep, so scheduled runs depend on it being
awake; this is a demonstration, not durable backup storage. Visitors may change
the shared sample until reset.

## Build and test locally

From the repository root:

```bash
docker build -f demo/Dockerfile -t actual-bench-demo .
bash demo/smoke.sh
```

The smoke test uses the generated seed's default server password and a temporary
API key. If the seed was generated with `SEED_PASSWORD`, use that password in a
local container test instead. The test starts under 2 CPU / 16 GB limits,
checks both budgets, module metadata and the initial backup, changes both data
stores, restarts the container, and checks the restored seeds and backup folder. It removes its test container. CI also
runs `demo/browser-smoke.cjs` in Chromium against the container.
The demo image limits build parallelism to fit the Hugging Face builder; normal
self-hosted builds are unaffected.

## Deploy and reset

See `docs/DEMO_DEPLOYMENT.md` in the repository for the full preparation,
Space settings, Vercel redirect, and verification instructions. The Space clone
uses Git Xet (or Git LFS) to track binary files before the deployment commit.
Prepare the
redirect before updating the Space, but promote it only after hosted checks and
a restart. Updating the Space changes its public port from HTTP API to Next.js,
so the current Vercel demo will be unavailable until the redirect is promoted.
A Space restart restores both seeds.
