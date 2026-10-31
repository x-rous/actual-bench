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
The demo Dockerfile limits build parallelism because unconstrained workers can
exhaust the Hugging Face builder and cause its build job to time out.

Run `docker build -f demo/Dockerfile -t actual-bench-demo .` followed by
`bash demo/smoke.sh`. CI additionally checks the four workspaces in Chromium.
The smoke script assumes the default seed password `demo-budget-public`; if you
use `SEED_PASSWORD`, supply the matching value when starting a container by
hand. Do not run the reset script against a container holding real data.

## Prepare the Vercel redirect before the cutover

The `actual-bench-demo` Vercel project uses a project routing rule to redirect
the existing public URL to the Space. Its regex source is `^/(?<path>.*)$`, its
destination is `https://x-rous-actual-bench-demo.hf.space/$path`, and its status
is 307. It preserves the path and query string. Once this rule is live, routine
Space updates do not need a new redirect.

If preparing a new cutover, stage and review the rule before updating the Space;
do not promote it yet. Vercel's [project routes API](https://vercel.com/docs/rest-api/project-routes)
supports staging and promotion. The separate bulk-redirect CLI commands require
a paid plan and are not available on the demo project's Hobby plan. Keep the
project and domain active; staging alone does not change the public link.


## Prepare the Space repository

After the changes and seeds have been reviewed and committed, install Git LFS
and [Git Xet](https://huggingface.co/docs/hub/xet/using-xet-storage#git).
Git Xet uses Git LFS pointers and uploads their contents to Xet. Git LFS alone
is a supported fallback. Prepare a fresh clone from the application repository
root; the Space Docker build needs the application source, not only `demo/`.
Skip downloading the old LFS files: the legacy backend seed directory and the
previous demo seed directory are removed from the Space checkout before the
current application files are copied. This leaves their remote LFS objects
untouched.

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://huggingface.co/spaces/x-rous/actual-bench-demo /tmp/actual-bench-demo-space
git -C /tmp/actual-bench-demo-space lfs install --local
git -C /tmp/actual-bench-demo-space xet install --local
git -C /tmp/actual-bench-demo-space rm -r --ignore-unmatch seed-data demo/seed-data generate-seed.mjs seed-scenario.cjs start.sh check-budgets.mjs
git archive HEAD | tar -x -C /tmp/actual-bench-demo-space
cp demo/Dockerfile /tmp/actual-bench-demo-space/Dockerfile
cp demo/README.md /tmp/actual-bench-demo-space/README.md
python3 demo/track-space-binaries.py /tmp/actual-bench-demo-space
git -C /tmp/actual-bench-demo-space add -A
git -C /tmp/actual-bench-demo-space diff --cached --stat
git -C /tmp/actual-bench-demo-space lfs ls-files
```

The helper scans the files being added for Git's binary marker and tracks them
in the Space clone's `.gitattributes` before staging. This includes the seed
databases and images, as well as binary files without common binary extensions.
Review the LFS list and staged changes before committing. Never commit raw
binary files and add tracking afterward: the rejected objects would remain in
the push history. The new image reads `demo/seed-data/` and
`demo/seed-manifest.json`. If Git Xet is unavailable, omit `xet install` and use
Git LFS's normal transfer instead. Keep Git LFS (and Git Xet, when used) on
`PATH` for the push; do not disable the LFS pre-push hook.

**Do not run `git push` until the redirect is staged and the outage window has
begun:**

```bash
cd /tmp/actual-bench-demo-space
# After reviewing the complete staged diff:
git diff --cached
git commit -m "chore(demo): deploy combined demo"
git lfs fsck --pointers --objects
git push
```

**Planned outage:** pushing this update replaces the HTTP API currently exposed
on the Space's public port 7860 with Next.js. The existing Vercel demo still
expects an HTTP API at that address, so its budget connections will fail once
the Space switches over. The outage lasts until the staged Vercel redirect is
promoted after the hosted checks below. Prepare the redirect first, then push
the Space update during the agreed outage window.

In Space settings, keep `app_port: 7860` and configure `API_KEY` and
`ACTUAL_SERVER_PASSWORD` as secrets. The password must match the one used for
seed generation. Changing a secret used by the current backend can also affect
the old demo, so make any necessary secret changes during the outage. The demo
API key is intentionally supplied to visitors so they can use the shared
sample; never reuse a real API key.

## Verify and reset

Open the Space's direct `hf.space` URL, choose each budget mode, and use the
connection switcher to move between them. Check:

- Budget Cockpit: household transactions, rules and schedules.
- Loans & Debt: the home mortgage, car loan, personal loan and investment-property loan, including their history and projections.
- Credit Cards: two cards, including a missed payment, interest and an instalment plan.
- Assets: Family Home, Family Car and Investment Property, their history and linked loans; check the rental income and expenses.
- Bank Reconciliation: completed, in-review and ready-to-apply checking sessions.
- FX Rates: the illustrative USD/AUD rate.
- Backups and Automations: the local demo destination and monthly Bench-metadata backup rule. An initial verified backup runs at startup to establish the schedule. This container-local destination and run history reset on restart; Space sleep can prevent scheduled runs.

Verify amounts and linked rows in both modes. Restart the Space, repeat the
checks, and confirm visitor changes disappeared from both Actual and Bench.
The app and metadata checks can be run against a local test container with
`node demo/check-metadata.mjs http://127.0.0.1:17860`; it is read-only. A
restart is the reset mechanism, with no separate scheduler. If the Space is
asleep, the first request may wait for it to wake.

## Activate the redirect

If this is a new cutover with a staged project routing rule, promote its reviewed
version through the [project routes API](https://vercel.com/docs/rest-api/project-routes/promote-restore-or-discard-a-routing-rule-version)
only after both hosted budget modes and every check under "Verify and reset"
pass, including confirming that a Space restart restores both data stores.
The API's `promote` action changes the public link immediately. For routine
updates the existing live rule already redirects traffic and does not need to
be promoted again.

Confirm `https://actual-bench-demo.vercel.app` redirects to the Space and both
budget modes open. Promoting changes the public link immediately.
