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
set it outside the Vercel demo build; it has no host guard. Analytics are
collected for visits that reach the Vercel UI; they are not collected for
visitors who go directly to the HF Space URL.

The Vercel project has a project-level routing rule named **Redirect demo to
Hugging Face**. Keep this rule disabled so Vercel can serve the UI on the
production and preview domains. If routing needs to be changed, manage the
rule under **Project CDN → Routing Rules**. Project-level routing changes are
published to production immediately. See Vercel's
[project routing rules guide](https://vercel.com/docs/routing/project-routing-rules).

### Required Vercel environment variables

Keep these variables configured for Production and Preview as appropriate:

| Variable | Purpose |
|---|---|
| `DEMO_MODE` | Enables the demo connection flow and disables sign-in on that host. Use only for the public demo; do not set on self-hosted instances. |
| `DEMO_BASE_URL` | Public HTTPS origin of the HF Space; also the Vercel `/api/*` rewrite target. |
| `DEMO_API_KEY` | Public demo key returned by the demo connection endpoint. It must only protect the disposable demo backend. |
| `DEMO_BUDGET_SYNC_ID` | Stable Sync ID for the Envelope seed. |
| `DEMO_TRACKING_BUDGET_SYNC_ID` | Stable Sync ID for the Tracking seed. |
| `NEXT_PUBLIC_ANALYTICS` | Set to `1` in the Vercel demo build to enable Web Analytics. It has no host guard; keep it unset in self-hosted builds. |

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

## Validate the demo container

From the repository root, build and test the combined demo image:

```bash
docker build -f demo/Dockerfile -t actual-bench-demo .
bash demo/smoke.sh
```

CI also runs the browser smoke test. The smoke script assumes the seed password
`demo-budget-public`; if `SEED_PASSWORD` is used to regenerate the seeds, use
the matching password for local tests. Never run the reset checks against a
container holding real data.

The GitHub Actions **Demo container** workflow runs this build and smoke test
for relevant pull requests and pushes. It validates the demo Docker image; it
does not deploy the public demo. The normal Vercel Git integration deploys UI
changes from `main`. The release workflow also has an optional Vercel deploy
hook for tagged releases when its deployment setting and secret are configured.
Keep these workflows in place: the demo-container test covers the demo image,
while the separate Docker smoke test covers the regular self-hosted image.

## Routing checks

For a routing configuration change:

1. Confirm the Vercel preview deployment build passes and the generated
   `routes-manifest.json` contains the `/api/:path*` rewrite to the HF Space.
   If the project-level redirect is enabled, it also applies to previews, so
   disable it before using a preview URL to verify the Vercel UI.
2. Verify the HF Space health endpoint. The image smoke test checks that both
   seeded budgets open and that restart restores the budget and metadata seeds.
   Do not dump the `/api/demo` response because it contains the public API key.
3. Inspect and save the live Project Routes version for rollback. Stage only
   the intended rule change, preserving unrelated rules. Publishing changes
   traffic immediately.
4. Immediately confirm `https://actual-bench-demo.vercel.app` serves the Vercel
   UI, `/api/health` and the demo connection work, and both budgets open. Do not
   dump the `/api/demo` response.
5. If the change causes problems, use the Vercel Routing Rules History to
   restore a known-good version.

For a local, read-only metadata check against a test container, run
`node demo/check-metadata.mjs http://127.0.0.1:17860`. If the Space is asleep,
its first request may take time to wake it.
