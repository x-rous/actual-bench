# Screenshots

The images in the documentation site are generated, not collected. A screenshot
that no longer matches the product teaches a reader a UI that is not there, so
retaking them has to cost one command rather than an afternoon.

```bash
node docs-site/scripts/capture-screenshots.mjs --serve --include-instance
```

That starts an Actual Bench instance of its own, seeds it, photographs every
page in the shot list, and throws the instance away. Images land in
`docs-site/src/assets/screenshots/`.

## What it photographs, and why it is safe

**The budget data is the public demo.** The script connects the instance to the
demo backend through the normal connect form, so every page shows the same
household a visitor sees when they click "Try the live demo" - and no real
person's finances can reach the documentation.

**The instance is disposable.** Some pages draw the *instance's own* metadata
rather than the connected budget - its backup destinations, automations, sync
flows, exchange rates, reconciliation sessions, the health of its own database,
and the dialogs that configure any of them. Pointing the script at a working
install photographs that install's schedule and where its backups go; an early
run did exactly that and the images had to be destroyed.

Those shots carry `instance: true`, which is the list - reading it in
`SHOTS` beats trusting an enumeration here to stay current - and they are
skipped unless `--include-instance` is passed, which is only ever correct for an
instance stood up for the purpose.

`docs-site/scripts/seed-screenshot-fixtures.mjs` gives that instance something
to show: a destination, a backup rule, and one real backup run so the inventory
holds a verified copy - the seeder fails rather than continuing if that run does
not report a result, because a Backups tab with nothing in it is a screenshot of
an explanation rather than of the feature. It works through the dialogs rather than by writing rows,
because the payload shapes are internal and will drift while the dialogs are the
contract - and because a seeder that breaks when a flow breaks is worth having.

## Requirements

- `npx playwright install chromium`.
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

## Two traps worth knowing

- **Reach the instance as `localhost`, never `127.0.0.1`.** Next 16 blocks
  dev-server infrastructure from other origins, and the page then renders
  perfectly without ever hydrating: every button is inert and nothing says why.
- **The demo host challenges automated browsers.** The script navigates by
  clicking the sidebar rather than loading each URL, which is also what a reader
  does; a first version produced eighteen identical pictures of a bot checkpoint.

## Adding a shot

Add an entry to `SHOTS` in the capture script. Beyond the name, the sidebar entry
to click and the URL it should land on:

| Field | For |
|---|---|
| `instance: true` | The page draws the instance's own metadata, so it is skipped unless `--include-instance` |
| `prepare(page)` | Drive the page into the state worth photographing - run the query, open the session, add the pair |
| `element` | Photograph one element rather than the page, which is how the dialogs are shot |
| `alsoConnect` | Connect a second budget for this shot, and switch back afterwards |
| `preConnect: true` | Photograph before any budget is opened - the only way to catch a first run |

A screenshot earns its place when the screen carries evidence or a judgement that
prose cannot: the reasoning behind a merge, a backtest, a match confidence, what
retention would delete. A form with two labelled fields is better described in a
sentence, and a page with a dozen images is a slideshow nobody reads.

## The README's copies

The README does not use these files directly. They are captured at 5x so they
hold up when a reader zooms into them on the documentation site, and a page of
seven of those comes to well over a gigabyte of decoded bitmap - past what a
browser will paint, so it paints nothing at all. The files were being served
correctly; the page simply could not draw them.

So the README has its own copies at a size suited to a page that shows them a few
hundred pixels wide:

```bash
node docs-site/scripts/readme-images.mjs
```

That reads from `docs-site/src/assets/screenshots/` and writes to
`docs/readme-images/`. Run it after retaking screenshots, or the README keeps
showing the previous ones. The list of which images the README uses lives at the
top of that script.

## Pages that need the demo's own Bench data

Financial Insights, Loans, Credit Cards, Assets, Cashflow Planning and Payee
Cleanup read what Bench stores about the demo household (loan terms, card
statements, registered assets), and a private instance does not have that. Their
guide screenshots are taken from the demo deployment itself:

```bash
node docs-site/scripts/capture-guides.mjs              # everything
node docs-site/scripts/capture-guides.mjs loans cards  # named groups
```

It photographs a 1920x1080 window at 3x and crops each shot to the part of the
page that shows the function, without the sidebar and top bar; a dialog is shot
on its own. The `cashflow` group creates a plan in the shared demo and deletes it
again. The front page's images come from `capture-landing.mjs` the same way, and
both share `demo-capture.mjs`.

A regenerated demo seed only reaches the public demo after it is merged and
deployed. To photograph it before that, serve it locally and point both scripts
at it with `BENCH_URL`; they then connect Direct instead of clicking the demo
button:

```bash
# Actual Server on a scratch copy of the seed (include the hidden .migrate)
cp -R demo/seed-data/. /tmp/demo-actual
ACTUAL_PORT=5197 ACTUAL_DATA_DIR=/tmp/demo-actual \
  ACTUAL_SERVER_FILES=/tmp/demo-actual/server-files ACTUAL_USER_FILES=/tmp/demo-actual/user-files \
  node node_modules/@actual-app/sync-server/build/bin/actual-server.js &
# A private Bench whose database is a copy of the seed's Bench data
cp demo/seed-bench.sqlite /tmp/demo-bench.sqlite
ACTUAL_BENCH_AUTH=none ACTUAL_BENCH_DB_PATH=/tmp/demo-bench.sqlite \
  ACTUAL_BENCH_DIST_DIR=.next-live-tmp npx next dev -p 3517 &

# Wait for each to answer (about three minutes at most; the first Bench page
# compiles), and capture only if both do
wait_for() {
  for i in $(seq 1 60); do
    curl -s -o /dev/null --max-time 2 "$1" && return 0
    sleep 1
  done
  echo "$1 did not answer" >&2
  return 1
}
wait_for http://localhost:5197 && wait_for http://localhost:3517 && \
BENCH_URL=http://localhost:3517 ACTUAL_URL=http://localhost:5197 \
  node docs-site/scripts/capture-landing.mjs
```

The front page's hero (`docs-site/src/components/landing/demo-household.ts`)
quotes the demo's balances and a few of its figures; update it with the seed.
