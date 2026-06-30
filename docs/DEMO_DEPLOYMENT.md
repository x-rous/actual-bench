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
                 └─ seed budget (baked into the image)
```

The UI never talks to the backend from the browser — calls go through the app’s
own server-side proxy, exactly like a self-hosted deployment.

## What happens when a visitor clicks “Try the live demo”

1. The connect screen asks the server route **`/api/demo`** whether a demo is
   configured. It answers only when the deployment opts in via demo env vars;
   otherwise it returns `404` and the button never appears.
2. On click, the app registers the returned demo connection and drops the
   visitor straight into the app.
3. From there it behaves like any other connection: the server-side proxy talks
   to the demo backend, which serves a ready-made sample budget.

The normal **“bring your own actual-http-api”** form remains the default path on
the same screen.

## The seed budget & self-reset

- A rich, realistic sample budget (multiple accounts, category groups,
  payees — including intentional duplicates to showcase merging — rules,
  schedules, several months of transactions, and budgeted amounts) is generated
  by **`demo/generate-seed.mjs`** and **baked into the backend image**.
- On every container start the backend restores that baked copy, so the demo
  **self-resets to a clean state** — visitor edits never persist. This is the
  reset mechanism; there is no separate cleanup job.

## Self-host safety

The demo layer is inert anywhere it isn’t explicitly enabled:

- **`/api/demo`** and the **“Try the live demo”** button activate only when the
  demo env vars are present. Self-hosted builds → endpoint `404`s, button hidden.
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
  until a maintainer redeploys it.
- **Self-hosted app:** unaffected by either; it ships via release tags.

## Where it lives in the repo

| Path | Purpose |
|---|---|
| `src/app/api/demo/route.ts` | Demo connection endpoint (env-gated) |
| `src/components/connect/DemoButton.tsx` | “Try the live demo” button |
| `src/components/demo-analytics.tsx` | Analytics wrapper (demo-only, tree-shaken) |
| `demo/Dockerfile`, `demo/start.sh` | Demo backend image (sync + REST in one) |
| `demo/generate-seed.mjs` | Regenerates the seed budget |
| `demo/seed-data/` | The baked seed budget |

To regenerate the seed budget, run `node demo/generate-seed.mjs` (see the script
header for prerequisites).
