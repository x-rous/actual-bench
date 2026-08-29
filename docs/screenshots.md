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

**The instance is disposable.** Backups, Automations, Budget File Sync and FX
Rates draw the *instance's own* metadata rather than the connected budget.
Pointing the script at a working install photographs that install's backup
destinations, its sync flows and its schedule; an early run did exactly that and
the images had to be destroyed. Those pages are marked `instance: true` in the
shot list and skipped unless `--include-instance` is passed, which is only ever
correct for an instance stood up for the purpose.

`docs-site/scripts/seed-screenshot-fixtures.mjs` gives that instance something
to show: a destination, a backup rule, and one real backup run so the inventory
holds verified copies. It works through the dialogs rather than by writing rows,
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

## Adding a page

Add an entry to `SHOTS` in the capture script - the name of the image, the
sidebar entry to click, the URL it should land on, and which demo budget to open.
Mark it `instance: true` if the page draws instance metadata.
