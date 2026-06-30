# Public Demo Deployment Guide

A public, free demo of Actual Bench:

- **UI** → Vercel (Hobby, free, no credit card)
- **Backend** → one Hugging Face Docker Space running `actual-server` (sync) behind
  `actual-http-api` (REST), with a **seed budget baked into the image** so the demo
  resets to a clean state on every restart.
- **Auto-deploy** → every release (`v*` tag) redeploys the Vercel demo.

The demo connect screen offers two paths:
1. **Try the live demo** → one click into the seeded budget on the HF backend.
2. **Bring your own actual-http-api** → the normal connect form (unchanged default).

```
visitor ─► Vercel: actual-bench UI ─(server-side /api/proxy)─► HF Space
                                                               ├─ actual-http-api  (:7860, public)
                                                               └─ actual-server    (:5006, internal)
                                                                  └─ seed budget (resets on restart)
```

---

## What's already done (in this repo)

These are committed — you don't need to write any code:

- **`src/app/api/demo/route.ts`** — returns the demo connection, but only when
  `DEMO_MODE=1` + the `DEMO_*` vars are set (404s for self-hosters).
- **`src/components/connect/DemoButton.tsx`** + wired into the connect page — the
  "Try the live demo" button, hidden unless `/api/demo` responds.
- **`demo/`** — the Hugging Face Space sources: `Dockerfile`, `start.sh`,
  `README.md`, and `generate-seed.mjs` (the seed generator).
- **`.github/workflows/release.yml`** — a `deploy-demo` job that redeploys Vercel
  on each release (enabled by repo variable `DEMO_DEPLOY_ENABLED=true`).

## What only you can do (account/auth-gated)

These need your logins, so they can't be automated from the repo:

1. Push `demo/` to your Hugging Face Space + set its secrets.
2. Import the repo into Vercel + set env vars + create the deploy hook.

(The seed budget is already generated and committed — no local step needed.)

## Values you'll collect

The seed budget is **already generated and committed** to `demo/seed-data/`, so two
of these values are fixed (Step 1 is optional — only re-run it to customize the data):

| Value | Value / where it comes from |
|---|---|
| `ACTUAL_SERVER_PASSWORD` | `demo-budget-public` (baked into the seed) |
| `DEMO_BUDGET_SYNC_ID` | `d49f6afd-71bf-411b-90e0-fbaf9d9bed4b` (baked into the seed) |
| `DEMO_API_KEY` | You choose it (Step 2.2) — any random string |
| `DEMO_BASE_URL` | Your Space URL (Step 2.3) |

The committed seed is a rich, realistic 4-month budget: 4 accounts (incl. an
off-budget Brokerage), 7 category groups / 19 categories, 36 payees (with
deliberate duplicates like Amazon / Amazon.com for the payee-merge demo), 15
rules (incl. duplicate + unused rules that the Rule Diagnostics flag), 5 monthly
schedules, ~129 transactions, and budgets set for every category each month.

---

## Step 1 — (Optional) Regenerate the seed budget

Skip this unless you want different demo data — `demo/seed-data/` is already
populated and committed.

The seed script spins up a temporary Actual sync server, creates a "Demo Budget"
with sample accounts + transactions, and writes the synced data into
`demo/seed-data/`. From the repo root (needs a C compiler for `better-sqlite3`):

```bash
npm i --no-save @actual-app/api @actual-app/sync-server
node demo/generate-seed.mjs
```


It prints a fresh `DEMO_BUDGET_SYNC_ID` and the `ACTUAL_SERVER_PASSWORD`. A new
budget gets a **new Sync ID** — update it in Vercel (Step 3.2). Override the
password with `SEED_PASSWORD=… node demo/generate-seed.mjs`.

---

## Step 2 — Backend: Hugging Face Docker Space

Your Space already exists: <https://huggingface.co/spaces/x-rous/actual-bench-demo>

### 2.1 Push the files

```bash
git clone https://huggingface.co/spaces/x-rous/actual-bench-demo
cd actual-bench-demo
cp -r /path/to/actual-bench/demo/* .   # README.md, Dockerfile, start.sh, seed-data/, generate-seed.mjs
git add .
git commit -m "Actual Bench demo backend"
git push
```

The Space's `README.md` already carries the required `sdk: docker` /
`app_port: 7860` metadata header.

### 2.2 Set the secrets

Space → **Settings → Variables and secrets → New secret**:

| Name | Value |
|---|---|
| `API_KEY` | Any random string → this becomes `DEMO_API_KEY` in Vercel |
| `ACTUAL_SERVER_PASSWORD` | The password from Step 1 (default `demo-budget-public`) |

### 2.3 Verify

HF builds and boots automatically. Open the **Logs** tab and wait for
`actual-server is up`. Then smoke-test (replace the key):

```bash
curl -H "x-api-key: <DEMO_API_KEY>" \
  https://x-rous-actual-bench-demo.hf.space/v1/budgets
```

You should get JSON listing the demo budget. Your `DEMO_BASE_URL` is
`https://x-rous-actual-bench-demo.hf.space`.

> If the build fails, it's almost always the `@actual-app/sync-server` npm install
> on Alpine — paste the failing log lines and we'll tweak `demo/Dockerfile`.

---

## Step 3 — UI: Vercel

### 3.1 Import the repo

1. At <https://vercel.com/new>, import `x-rous/actual-bench`.
2. Framework Preset = **Next.js** (auto-detected). Leave build settings default.
   - This project uses `distDir: ".next-build"`; recent Vercel reads that from
     `next.config.ts` automatically. If a build ever fails looking for `.next`,
     keep Build Command = `next build` and Output Directory = default — do **not**
     hardcode `.next`.

### 3.2 Environment variables

Project → **Settings → Environment Variables** (scope: Production, and Preview if
you want demo previews):

| Name | Value |
|---|---|
| `DEMO_MODE` | `1` |
| `DEMO_BASE_URL` | `https://x-rous-actual-bench-demo.hf.space` |
| `DEMO_API_KEY` | the `API_KEY` from Step 2.2 |
| `DEMO_BUDGET_SYNC_ID` | the Sync ID from Step 1 |

### 3.3 Deploy

Redeploy (Deployments → Redeploy) so the env vars take effect. You'll get a URL
like `https://actual-bench-<hash>.vercel.app`.

---

## Step 4 — Verify end-to-end

1. Open your Vercel URL.
2. You should see **"Try the live demo"** above the connect form.
   - Not showing? `/api/demo` is 404ing → re-check the four Vercel env vars and
     redeploy.
3. Click it → you land in the app on the seed budget's accounts and transactions.
   - First click after the Space has been idle takes ~30–60s (HF cold start).
4. Confirm the normal form still works: enter any other actual-http-api URL + key.

---

## Step 5 — Auto-deploy the demo on each release

1. Vercel → **Settings → Git → Deploy Hooks** → create one (branch `main`), copy
   the URL.
2. GitHub repo → **Settings → Secrets and variables → Actions**:
   - **Secrets** → add `VERCEL_DEPLOY_HOOK` = the hook URL.
   - **Variables** → add `DEMO_DEPLOY_ENABLED` = `true` (this enables the
     `deploy-demo` job in `release.yml`).

Now every `v*` release fires the hook and Vercel rebuilds from the tagged commit.

> Vercel also auto-deploys on every push to `main` by default — fine, the demo just
> tracks `main`; the hook guarantees a release-time deploy too. To deploy **only**
> on releases, set an "Ignored Build Step" in Vercel and rely solely on the hook.

---

## Maintenance & caveats

- **Cold starts:** free HF Spaces sleep after ~48h idle; first visit wakes it
  (~30–60s).
- **Self-resetting data:** the budget is baked into the image and re-copied on
  every boot, so visitor edits vanish on restart. Force a reset by restarting the
  Space.
- **Updating the seed:** re-run Step 1, push `demo/seed-data/` to the Space. A
  brand-new budget gets a new Sync ID — update `DEMO_BUDGET_SYNC_ID` in Vercel.
- **Cost:** $0. Vercel Hobby (non-commercial) + HF free Space. No credit card.
- **Security:** the demo API key is intentionally public — it only gates a
  throwaway sandbox. Keep self-hosted deployments free of all `DEMO_*` vars so the
  demo button and `/api/demo` stay disabled there.
