# Screenshots

The images in the documentation site are generated, not collected. A screenshot
that no longer matches the product teaches a reader a UI that is not there, so
retaking them has to cost a couple of commands rather than an afternoon.

Two scripts take them, and both write into `docs-site/src/assets/screenshots/`:

| Script | Photographs | Groups |
|---|---|---|
| `docs-site/scripts/capture-pages.mjs` | Getting started, Budget Setup, the Budget Cockpit grid, Analyze & Cleanup, Bank Reconciliation, Sync & Automations, App Health | `start`, `setup`, `cockpit`, `tools`, `recon`, `ops` |
| `docs-site/scripts/capture-guides.mjs` | Financial Insights, the Cockpit drill-throughs, Loans, Credit Cards, Assets, Cashflow Planning, Payee Cleanup | `insights`, `budget`, `loans`, `cards`, `assets`, `cashflow`, `payee-cleanup` |

Name groups on the command line to take only those; name none to take them all.
The front page's images come from `capture-landing.mjs`. All three share
`demo-capture.mjs`.

## The data is the demo household

Every image shows the fictional household from the public demo, so no real
person's finances can reach the documentation. That includes the bank statement
in the reconciliation shots: `demo-statement.mjs` prints a PDF for the demo's
checking account from the seed's own transactions, under a bank that says on the
page that it is fictional. Never photograph a real statement, budget or install.

## Take them from a local seed

Run both scripts against a private copy of the demo seed. The `recon` and `ops`
groups create things (a reconciliation session, backups, a sync flow), so they
refuse to run against the shared public demo; the other groups can, but a local
seed is also how you photograph a regenerated seed before it is deployed.

First build the seed's Bench database, `demo/seed-bench.sqlite`. It is not
committed; this builds it from the committed `demo/seed-manifest.json`, as the
demo image does, without touching the seed itself (`demo/README.md` covers
regenerating the whole seed):

```bash
node demo/generate-metadata.cjs
```

Then start an Actual Server and a Bench of your own on the seed, and capture:

```bash
port_free() { ! curl -s -o /dev/null --max-time 2 "http://localhost:$1"; }
wait_for() {   # wait_for <url> <pid>: the server we started must be the one answering
  for i in $(seq 1 90); do
    kill -0 "$2" 2>/dev/null || { echo "the server for $1 exited" >&2; return 1; }
    curl -s -o /dev/null --max-time 2 "$1" && return 0
    sleep 2
  done
  echo "$1 did not answer" >&2
  return 1
}

# Bench's data goes under /data as in Docker, so App Health shows the paths a
# reader will see; the seed's backup destination is /data/backups, which must
# exist and be empty. Use a disposable container, or a machine where you created
# /data yourself and can write to it. Nothing starts if /data already holds a
# Bench, if the seed cannot be copied, or if either port is taken.
seeded=false
if [ -e /data/actual-bench.sqlite ]; then
  echo "/data already holds a Bench database; use a disposable machine or container" >&2
elif ! port_free 5197 || ! port_free 3517; then
  echo "port 5197 or 3517 is already in use; stop that server first" >&2
elif rm -rf /tmp/demo-actual && cp -R demo/seed-data/. /tmp/demo-actual \
    && mkdir -p /data/backups && cp demo/seed-bench.sqlite /data/actual-bench.sqlite; then
  seeded=true
  # Actual Server on a scratch copy of the seed (the copy includes the hidden .migrate)
  ACTUAL_PORT=5197 ACTUAL_DATA_DIR=/tmp/demo-actual \
    ACTUAL_SERVER_FILES=/tmp/demo-actual/server-files ACTUAL_USER_FILES=/tmp/demo-actual/user-files \
    node node_modules/@actual-app/sync-server/build/bin/actual-server.js &
  actual_pid=$!
  ACTUAL_BENCH_AUTH=none ACTUAL_BENCH_DB_PATH=/data/actual-bench.sqlite \
    ACTUAL_BENCH_DIST_DIR=.next-live-tmp npx next dev -p 3517 &
  bench_pid=$!
else
  echo "could not copy the seed" >&2
fi

# The first Bench page compiles, so the wait can take a minute.
[ "$seeded" = true ] && wait_for http://localhost:5197 "$actual_pid" \
  && wait_for http://localhost:3517/connect "$bench_pid" && {
  export BENCH_URL=http://localhost:3517 ACTUAL_URL=http://localhost:5197
  node docs-site/scripts/capture-pages.mjs
  node docs-site/scripts/capture-guides.mjs
}
```

Start from a fresh copy of the seed database for every full run: the `recon` and
`ops` groups expect the seed's state, and a second run on the same database finds
the first run's session, flow and backups already there.

`next dev` regenerates its agent notes in `AGENTS.md` and adds its build folder to
`tsconfig.json`. Restore both with `git checkout -- AGENTS.md tsconfig.json`
before committing.

Set `SHOT_DEBUG_DIR` to a folder to get a full-window picture of the page
whenever a shot fails.

## What a good shot looks like

- **Cropped to what the page is for.** The sidebar and top bar stay out: a whole
  window shrinks to unreadable in a text column, and its sidebar dates the image
  the next time a page is renamed. Tables are cut where their rows end, panels and
  dialogs are photographed on their own, and a page with a wide empty area is cut
  before it.
- **A state worth seeing.** A reconciliation with a difference to explain, a
  backup list with verified copies, a sync preview that found duplicates. An empty
  list is a picture of an explanation, not of the feature.
- **Nothing that was only happening.** Toasts and the development overlay are
  hidden; a staged edit is discarded once its shot is taken.

A screenshot earns its place when the screen carries evidence or a judgement that
prose cannot: the reasoning behind a merge, a match confidence, what a rule would
change, what a backup protects. A form with two labelled fields is better
described in a sentence.

## Size

The window is 1920x1080 (1440x900 for the Budget Setup tables, so their text is
not lost in a wide, sparse row), captured at 2x. The documentation site shows each
image at its width divided by two (`docs-site/src/plugins/screenshot-size.mjs`),
so a dialog appears at its real size instead of stretched to the column, and a
wide page shrinks to fit and opens full size on click. `SCALE` in
`demo-capture.mjs` and the plugin must agree.

## Adding a shot

Add a `step` to the right group in `capture-pages.mjs` or `capture-guides.mjs`.
The helpers from `shooter()` do the cropping:

| Helper | For |
|---|---|
| `shoot(page, name, crop)` | A region in CSS pixels; `belowChrome(height, right)` gives one below the sidebar and top bar |
| `shootTo(page, name, locator, options)` | Below the chrome, down to where `locator` ends: the way to cut a table at its last row |
| `element(locator, name)` | One element, such as a dialog or a panel |

Write the image's alt text from what it shows, numbers included, so it reads
correctly to someone who cannot see it.

## Requirements

- `npx playwright install chromium-headless-shell`.
- A machine with the usual desktop libraries. Without root, fetch them into a
  directory and point `LD_LIBRARY_PATH` at it:

  ```bash
  npx playwright install-deps --dry-run chromium   # the package list
  apt-get download <packages>                      # works without root
  dpkg-deb -x <each>.deb ~/.local/chromium-libs
  export LD_LIBRARY_PATH=~/.local/chromium-libs/usr/lib/x86_64-linux-gnu:~/.local/chromium-libs/lib/x86_64-linux-gnu
  ```

  Pin `libasound2` to the release matching the host's glibc; the newest build
  wants a newer one than Ubuntu 24.04 provides.

**Reach the instance as `localhost`, never `127.0.0.1`.** Next 16 blocks
dev-server infrastructure from other origins, and the page then renders
perfectly without ever hydrating: every button is inert and nothing says why.

## The README's copies

The README does not use these files directly. It has its own smaller copies, sized
for a page that shows them a few hundred pixels wide:

```bash
node docs-site/scripts/readme-images.mjs
```

That reads from `docs-site/src/assets/screenshots/` and writes to
`docs/readme-images/`. Run it after retaking screenshots, or the README keeps
showing the previous ones. The list of images the README uses is at the top of
that script.

The front page's hero (`docs-site/src/components/landing/demo-household.ts`)
quotes the demo's balances and a few of its figures; update it with the seed.
