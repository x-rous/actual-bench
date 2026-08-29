# Demo Architecture

How the public **“Try the live demo”** experience is built. This is a conceptual
overview — it is intentionally free of credentials and environment-specific
values. None of this affects self-hosting; the demo is a separate layer.

## Two products, one repo

The same codebase serves two independent things:

| | Self-hosted app | Public demo |
|---|---|---|
| **Who** | You, on your own server | Anyone, to try it out |
| **Runs on** | Your infrastructure (Docker) | A managed UI host + a managed backend |
| **Built/deployed by** | Release tags → Docker image | Git pushes → managed host |

Everything demo-specific is **gated behind environment variables**, so a
self-hosted build contains none of it (see *Self-host safety* below).

## Topology

```
visitor ─► Demo UI (Next.js, managed host)
              │  server-side proxy (/api/proxy)
              ▼
           Demo backend (single container)
              ├─ actual-http-api   (REST, public port)
              └─ actual-server     (sync, internal only)
                 └─ Envelope + Tracking seed budgets (baked into the image)
```

The UI never talks to the backend from the browser — calls go through the app’s
own server-side proxy, exactly like a self-hosted deployment.

## What happens when a visitor starts the demo

1. The connect screen asks the server route **`/api/demo`** whether a demo is
   configured. It answers only when the deployment opts in via demo env vars;
   otherwise it returns `404` and the demo panel never appears.
2. The panel offers **one button per budget mode** — `Envelope demo` and
   `Tracking demo`, named from the labels the route returns. A visitor already
   budgets one way or the other, and a single button opening Envelope started
   Tracking users in the wrong model.
3. Whichever is chosen, the app registers **both** demo-budget connections and
   opens the chosen one. The top-bar connection menu lists both, so the other
   mode is one budget switch away and the two equivalent datasets can still be
   compared.
4. From there each behaves like any other connection: the server-side proxy
   talks to the demo backend, which serves the selected sample budget.

The normal **“bring your own actual-http-api”** form remains the default path on
the same screen.

## The seed budget & self-reset

- Two rich, realistic sample budgets are generated from deterministic equivalent
  data by **`demo/generate-seed.mjs`** and **baked into the backend image**:
  `Live Demo - Envelope` uses Envelope mode; `Live Demo - Tracking` uses Tracking
  mode and also plans income. Both contain twelve completed months plus the
  current partial month, a broad household category structure, seasonal budget
  plans, intentionally good and difficult months, duplicate payees, 30+ rules,
  rule-diagnostic examples, 12 schedules, 10 tags with tagged activity, real
  transfers, split purchases, imported metadata, notes, and mixed transaction
  clearing/reconciliation states.
- The generator validates minimum entity and transaction counts, expected mode,
  rule-diagnostic coverage, and equivalent transactions/expense plans before it
  publishes the seed directory.
- The committed seed retains stable Sync IDs across regenerations, avoiding a
  coordinated Demo UI environment update for ordinary data refreshes. If those
  IDs are intentionally changed, update both Vercel variables before deployment.
- On every container start the backend restores that baked copy, so the demo
  **self-resets to a clean state** — visitor edits never persist. This is the
  reset mechanism; there is no separate cleanup job.

## When a budget lists but will not open

The failure mode worth recognising: the backend answers `GET /v1/budgets` with
both demo budgets, serves one of them perfectly, and returns
`500 Unknown error while interacting with Actual Api` for **every** request
against the other. In the UI that surfaces as *"Failed to load budget management
data. Please check your connection and try again"* on one demo budget only.

A listed budget is not an openable one. That listing merges the sync server's
files (`state: "remote"`) with the API's own **local cache**, and when this
happened the broken budget appeared in the cache with **neither a `cloudFileId`
nor a `groupId`** - so nothing could resolve its Sync ID, and every request for
it failed:

```json
{ "id": "…-Envelope-283b5a7", "cloudFileId": "0389217b…", "groupId": "7d243b3e…", "name": "Live Demo - Envelope" }
{ "id": "…-Tracking-1272172", "name": "…-Tracking-1272172" }
```

**It was not a stale deploy.** The Space's Dockerfile, `start.sh` and seed were
byte-identical to this repo, and the seed opens both budgets when tested against
a local sync server. The cache is filled at *runtime*, by the first request for
each budget, and a download that fails or is interrupted - two visitors opening
the same budget at once is enough - leaves a half-written entry that shadows the
real file for the life of the container. The Envelope budget, opened first and
more often, never hit it.

Two things follow, and both are now in place:

- **Restarting fixes it.** `start.sh` wipes `/data` on every boot, and the budget
  cache lives there, so a rebuild or restart of the Space clears the bad entry.
- **The boot check keeps it from recurring silently.** `check-budgets.mjs` opens
  every budget once the API is up, which fills the cache serially before any
  visitor can race it, and prints the result into the Space log.

If a budget still fails after a restart, the seed itself is suspect: regenerate
it (`node demo/generate-seed.mjs`), which validates both budgets before writing
them, and redeploy.

## Self-host safety

The demo layer is inert anywhere it isn’t explicitly enabled:

- **`/api/demo`** and the **“Try the live demo”** button activate only when the
  demo env vars are present, including both distinct budget Sync IDs. Self-hosted
  builds → endpoint `404`s, button hidden.
- **Analytics** is loaded through a build-flag-gated dynamic import, so it is
  **tree-shaken out of non-demo builds** entirely — no script, no network calls.
- The build output directory differs only on the managed UI host (it expects the
  framework default); self-hosted/CI/Docker builds keep the project’s own dir.

No demo credentials live in self-hosted builds, and none are required to
self-host.

## How deploys happen

- **Demo UI:** the managed host builds a **preview on every push/PR**
  (maintainer-only, access-protected) and a **production deploy on every merge to
  `main`**. CI and the host build run independently/in parallel.
- **Demo backend:** deployed **manually and separately** from its own
  `demo/` sources — editing `demo/` in a PR does **not** update the live backend
  until a maintainer redeploys it. **Verify every backend deploy** with
  `node demo/check-budgets.mjs --url <space-url> --key <API_KEY>`: it opens each
  budget and exits non-zero if any cannot be served. The same script runs at
  container boot, so the Space log answers the question too.
- **Self-hosted app:** unaffected by either; it ships via release tags.

## Where it lives in the repo

| Path | Purpose |
|---|---|
| `src/app/api/demo/route.ts` | Demo connection endpoint (env-gated) |
| `src/components/connect/DemoButton.tsx` | “Try the live demo” button |
| `src/components/demo-analytics.tsx` | Analytics wrapper (demo-only, tree-shaken) |
| `demo/Dockerfile`, `demo/start.sh` | Demo backend image (sync + REST in one) |
| `demo/generate-seed.mjs` | Regenerates both seed budgets |
| `demo/seed-data/` | The two baked seed budgets |

To regenerate the seed budgets, run `node demo/generate-seed.mjs` (see the script
header for prerequisites). Configure the printed `DEMO_BUDGET_SYNC_ID` and
`DEMO_TRACKING_BUDGET_SYNC_ID` values on the Demo UI deployment. The backend
uses pinned `26.8.1` Actual Server and HTTP API images so generation and runtime
interpret the budget files with the same release line.
