# Public demo deployment

The public demo uses Vercel for its UI and analytics, and the Hugging Face
Space for its stateful server-side API and Actual backend:

```text
visitor ─► Vercel: Next.js UI + Web Analytics
                 └─ /api/* rewrite ─► HF Space: Next.js API + SQLite metadata
                                         ├─ actual-http-api
                                         └─ Actual Server + seeded budgets
```

The `actual-bench-demo` Vercel project is connected to this repository with
`main` as its production branch. Vercel deploys production on pushes to `main`
and creates preview deployments for pull requests. The HF Space remains the
shared fictional sandbox: its SQLite metadata database and Actual budget files
are restored from the image seeds at container startup. Visitor changes last
until the Space restarts. Never use real financial data or mount real data at
`/data`.

## Vercel UI and API proxy

The Vercel build uses `DEMO_MODE=1` and `DEMO_BASE_URL` as the HTTPS origin of
the HF Space. In `next.config.ts`, Vercel builds rewrite every `/api/*` request
to that Space before matching the Vercel app's API routes. This keeps the UI
code and static assets on Vercel while the HF server handles demo connections,
the Actual API proxy, and the SQLite-backed features. Browser requests remain
same-origin; Actual HTTP operations continue through the server queue in the HF
application.

The rewrite is limited to the Vercel demo build. Local development, CI, and
self-hosted deployments do not use it. Keep the Vercel `DEMO_BASE_URL` set to
the public Space origin (not the container-only `127.0.0.1:5007` URL).

Vercel's `NEXT_PUBLIC_ANALYTICS=1` enables Web Analytics in the UI. Do not
disable it if Vercel analytics are wanted. Analytics are collected for visits
that reach the Vercel UI; they are not collected for visitors who go directly
to the HF Space URL.

The project currently has a Vercel Project Routes rule that redirects all paths
to the HF Space. That rule must be removed for Vercel to serve the UI. Keep the
project and its `actual-bench-demo.vercel.app` domain. Before promoting a route
change, inspect the live rules and stage a version that removes only the
catch-all HF redirect while preserving any unrelated rules. Vercel documents
this in the [Project Routes API](https://vercel.com/docs/rest-api/project-routes).
Promoting the staged version changes production traffic immediately; retain the
previous live version so the redirect can be restored if rollback is needed.

### Required Vercel environment variables

Keep these variables configured for Production and Preview as appropriate:

| Variable | Purpose |
|---|---|
| `DEMO_MODE` | Enables the demo connection flow. |
| `DEMO_BASE_URL` | Public HTTPS origin of the HF Space; also the Vercel `/api/*` rewrite target. |
| `DEMO_API_KEY` | Public demo key returned by the demo connection endpoint. It must only protect the disposable demo backend. |
| `DEMO_BUDGET_SYNC_ID` | Stable Sync ID for the Envelope seed. |
| `DEMO_TRACKING_BUDGET_SYNC_ID` | Stable Sync ID for the Tracking seed. |
| `NEXT_PUBLIC_ANALYTICS` | Set to `1` to enable Vercel Web Analytics. |

Do not print or log the API key. The demo endpoint intentionally returns it to
visitors; never reuse a real server's API key.

## Hugging Face Space

The Space runs the demo-only Next.js server, Actual Server, and
`actual-http-api` in one container. The Space's Next.js server is the backend
for Vercel's `/api/*` rewrites; the app UI it also serves directly is a
secondary access path.

Keep `app_port: 7860` and the existing Space secrets `API_KEY` and
`ACTUAL_SERVER_PASSWORD`. The startup script copies the matching Actual and
Bench seeds into `/data`, starts the services, and checks that both advertised
budgets can be opened. A restart resets the shared sample. The local backup
destination and run history also reset; scheduled automations only run while
the Space is awake.

For a seed or backend-code change, regenerate the paired data as described in
[`demo/README.md`](../demo/README.md), review the manifest and seed files
together, then rebuild and update the Space repository. Use Git Xet or Git LFS
for binary files, tracking them before committing. A UI-only change does not
require an HF update because Vercel builds the UI from `main`. If a change adds
or changes an API route, app-database schema, or other server behavior, update
the HF Space too; its server-side code does not automatically track GitHub
merges.

## Validate before changing production routing

From the repository root, build and test the combined demo image:

```bash
docker build -f demo/Dockerfile -t actual-bench-demo .
bash demo/smoke.sh
```

CI also runs the browser smoke test. The smoke script assumes the seed password
`demo-budget-public`; if `SEED_PASSWORD` is used to regenerate the seeds, use
the matching password for local tests. Never run the reset checks against a
container holding real data.

Before removing the Vercel redirect:

1. Confirm the Vercel preview deployment serves the app and that its `/api/*`
   requests reach the HF Space. Check the health endpoint and open both demo
   budgets; do not dump the `/api/demo` response because it contains the public
   API key.
2. Verify the same feature areas on both budgets: transactions, rules,
   schedules, loans, cards, assets, reconciliation, FX, backups, and automation
   metadata.
3. Confirm restarting the Space restores both Actual budgets and the Bench
   metadata seed.
4. Stage removal of only the catch-all Vercel redirect, preserve other project
   routes, and promote only after the preview and hosted checks pass.
5. Confirm `https://actual-bench-demo.vercel.app` serves the Vercel UI, the
   demo connection works for both budgets, and Vercel Analytics continues to
   record visits.

For a local, read-only metadata check against a test container, run
`node demo/check-metadata.mjs http://127.0.0.1:17860`. If the Space is asleep,
its first request may take time to wake it.
