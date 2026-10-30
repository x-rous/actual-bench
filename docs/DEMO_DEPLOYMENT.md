# Public demo deployment

The demo is a shared fictional sandbox. The combined Hugging Face Docker Space
runs Next.js on port 7860, with Actual Server and actual-http-api on internal
ports. Its SQLite metadata database and the two Actual files live in the same
container. They are restored from matching image seeds on every container start;
visitor changes last only until that restart. This setup is independent of the
normal self-hosted Docker image. Never mount real data at `/data` in this demo.

## Regenerate and validate

Follow `demo/README.md` from the repository root. `node demo/generate-seed.mjs`
generates equivalent Envelope and Tracking budgets and `demo/seed-manifest.json`
from the same run. It validates the two budgets and builds an ignored local
Bench SQLite database through the application repositories. The image build
rebuilds the database from that manifest. Keep the manifest and `seed-data/`
from the same run: their Actual account and transaction IDs must agree. The
stable Sync IDs are already configured in `demo/Dockerfile`.

Run `docker build -f demo/Dockerfile -t actual-bench-demo .` followed by
`bash demo/smoke.sh`. CI additionally checks the four workspaces in Chromium.
The smoke script assumes the default seed password `demo-budget-public`; if you
use `SEED_PASSWORD`, supply the matching value when starting a container by
hand. Do not run the reset script against a container holding real data.

## Prepare the Space repository

After the changes and seeds have been reviewed and committed, prepare a clean
clone of the existing Space from the repository root. The Space Docker build
needs the application source, not only the old `demo/` directory:

```bash
git clone https://huggingface.co/spaces/x-rous/actual-bench-demo /tmp/actual-bench-demo-space
git archive HEAD | tar -x -C /tmp/actual-bench-demo-space
cp demo/Dockerfile /tmp/actual-bench-demo-space/Dockerfile
cp demo/README.md /tmp/actual-bench-demo-space/README.md
cd /tmp/actual-bench-demo-space
git status --short
```

Remove obsolete top-level files from the old backend-only Space after reviewing
`git status`; the new image reads `demo/seed-data/` and `demo/seed-manifest.json`.
Review the complete staged diff, then commit and push the Space repository to
build and deploy it. In Space settings, keep `app_port: 7860` and configure
`API_KEY` and `ACTUAL_SERVER_PASSWORD` as secrets. The password must match the
one used for seed generation. The demo API key is intentionally supplied to
visitors so they can use the shared sample; never reuse a real API key.

## Preserve the old demo link

After validating the new Space, link the Vercel CLI to the existing demo project
and stage the two project-level redirects:

```bash
vercel link
vercel redirects add / https://x-rous-actual-bench-demo.hf.space/ --status 307 --preserve-query-params
vercel redirects add '/*' 'https://x-rous-actual-bench-demo.hf.space/:splat' --status 307 --preserve-query-params
vercel redirects list --staging
vercel redirects list-versions
# After reviewing the staged version ID shown above:
vercel redirects promote <version-id>
```

Select the project that owns `actual-bench-demo.vercel.app` when linking. Keep
the project and domain active. Promoting changes the public link immediately;
changing this repository alone does not configure the Vercel project.

## Verify and reset

Open the Space's direct `hf.space` URL, choose each budget mode, and use the
connection switcher to move between them. Check:

- Budget Cockpit: household transactions, rules and schedules.
- Loans & Debt: Home Mortgage and Car Loan, their history and projections.
- Credit Cards: Everyday Rewards Card and its saved statements.
- Assets: Family Home and Family Car, their valuation history and linked loans.
- Bank Reconciliation: the completed Household Checking session.

Verify amounts and linked rows in both modes. Restart the Space, repeat the
checks, and confirm visitor changes disappeared from both Actual and Bench.
The app and metadata checks can be run against a local test container with
`node demo/check-metadata.mjs http://127.0.0.1:17860`; it is read-only. A
restart is the reset mechanism, with no separate scheduler. If the Space is
asleep, the first request may wait for it to wake.
