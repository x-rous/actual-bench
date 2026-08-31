#!/usr/bin/env node
/**
 * Capture the documentation screenshots from the public demo budgets.
 *
 * Screenshots go stale the moment a page changes, and a stale screenshot is
 * worse than none: it teaches a reader a UI that is not there any more. So this
 * is a script rather than a folder of images somebody once took - when a page
 * changes, one command retakes it.
 *
 * **The demo data is the only data.** Those budgets are already public, so
 * nothing here can put a real person's finances into the documentation, and a
 * reader sees the same household in the docs that they see when they click
 * "Try the live demo".
 *
 * **The demo UI is not the app it drives.** The demo deployment sits behind a
 * bot checkpoint that challenges automated browsers - a first attempt produced
 * eighteen identical pictures of "Failed to verify your browser". So the script
 * points *any* Actual Bench instance at the demo's backend through the normal
 * connect form, which is also a truer picture: what a reader sees is the app
 * they will run, not the demo host. Connections live in `sessionStorage`, so a
 * run leaves nothing behind on whichever instance was used.
 *
 * Light theme throughout, matching the docs site's default.
 *
 * Usage:
 *   # the whole thing: start a private instance, seed it, capture, tear it down
 *   node docs-site/scripts/capture-screenshots.mjs --serve --include-instance
 *
 *   node docs-site/scripts/capture-screenshots.mjs rules backups    # named shots
 *   APP_URL=http://localhost:3000 node docs-site/scripts/capture-screenshots.mjs
 *
 * Requires Playwright's Chromium (`npx playwright install chromium`); on a
 * machine without the usual desktop libraries, see docs/screenshots.md for
 * running it without root.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { connectSecondBudget } from "./seed-screenshot-fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "src", "assets", "screenshots");

/** The Actual Bench instance to photograph. `--serve` starts a private one. */
let appUrl = (process.env.APP_URL ?? "http://localhost:3999").replace(/\/+$/, "");
/** Where the demo's connection details come from - no credentials live here. */
const DEMO_UI = (process.env.DEMO_UI_URL ?? "https://actual-bench-demo.vercel.app").replace(/\/+$/, "");

const VIEWPORT = { width: 1440, height: 900 };

/**
 * Select the current month's column header, which is what opens the month
 * summary in the details panel. The header carries "(current month)" in its
 * label, so it can be found without knowing today's date.
 */
async function selectCurrentMonth(page) {
  const header = page.locator('[aria-label^="Month: "][aria-label*="current month"]').first();
  await header.waitFor({ timeout: 30000 });
  await header.click();
  await page.waitForTimeout(6000);
}

/**
 * The shot list. `nav` is the sidebar entry to click, which is also how a
 * reader gets there; `budget` picks which demo to open, and only the pages
 * making a point about budgeting mode ask for Tracking.
 *
 * `instance: true` marks a page that renders the **instance's own metadata** -
 * its automations, backup destinations, sync flows, exchange rates,
 * reconciliation sessions - rather than the connected budget. Those show
 * whatever the instance being photographed has configured, so running this
 * against somebody's working install captures their backup destinations and
 * their schedule; the first run of this script did exactly that and the images
 * had to be destroyed. They are skipped unless `--include-instance` says
 * otherwise, which is only ever correct against an instance stood up for the
 * purpose with an empty metadata database.
 */
const SHOTS = [
  { name: "overview", area: "getting-started", nav: "Overview", url: /\/overview/, budget: "Envelope" },
  { name: "budget-envelope", nav: "Budget", url: /\/budget-management/, budget: "Envelope" },
  { name: "budget-tracking", nav: "Budget", url: /\/budget-management/, budget: "Tracking" },
  {
    name: "budget-details-month",
    nav: "Budget",
    url: /\/budget-management/,
    budget: "Envelope",
    // Selecting a month header - and nothing else - is what puts the month
    // summary in the panel: where To Budget comes from line by line, then the
    // month's own activity.
    prepare: async (page) => selectCurrentMonth(page),
  },
  {
    name: "budget-details-month-tracking",
    nav: "Budget",
    url: /\/budget-management/,
    budget: "Tracking",
    // The same selection on a Tracking budget reads differently: income and
    // expenses against plan, a variance for each, and the pace meter.
    prepare: async (page) => selectCurrentMonth(page),
  },
  {
    name: "budget-details-category",
    nav: "Budget",
    url: /\/budget-management/,
    budget: "Envelope",
    // Groups arrive collapsed, so the category rows have to be revealed before
    // one can be selected. Groceries: twelve months of real activity behind it,
    // so the panel has averages and a trend to show rather than dashes.
    prepare: async (page) => {
      await page.getByRole("button", { name: "Expand all groups" }).click();
      await page.waitForTimeout(2500);
      await page.locator('[aria-label="Category: Groceries"]').first().click();
      await page.waitForTimeout(6000);
    },
  },
  {
    name: "budget-details-group",
    nav: "Budget",
    url: /\/budget-management/,
    budget: "Envelope",
    prepare: async (page) => {
      await page.locator('[aria-label="Category group: Food & Dining"]').first().click();
      await page.waitForTimeout(6000);
    },
  },
  {
    name: "budget-actuals",
    nav: "Budget",
    url: /\/budget-management/,
    budget: "Envelope",
    // What was actually spent, month by month, rather than what was planned -
    // the same grid answering the other question. A category is selected too,
    // so the panel puts one category's spending history beside the totals.
    prepare: async (page) => {
      await page.getByRole("button", { name: "Actuals", exact: true }).click();
      await page.waitForTimeout(3000);
      await page.getByRole("button", { name: "Expand all groups" }).click();
      await page.waitForTimeout(2500);
      await page.locator('[aria-label="Category: Restaurants"]').first().click();
      await page.waitForTimeout(6000);
    },
  },
  { name: "rules", nav: "Rules", url: /\/rules$/, budget: "Envelope" },
  { name: "rule-diagnostics", nav: "Rule Diagnostics", url: /\/rules\/diagnostics/, budget: "Envelope" },
  { name: "payee-cleanup", nav: "Payee Cleanup", url: /\/payees\/cleanup/, budget: "Envelope" },
  {
    name: "bank-reconciliation",
    nav: "Bank Reconciliation",
    url: /\/reconciliation/,
    budget: "Envelope",
    instance: true,
    // The sidebar lands on the list of sessions; the workbench is inside one.
    prepare: async (page) => {
      const open = page
        .getByRole("link", { name: /Open/ })
        .or(page.getByRole("button", { name: /Open/ }))
        .first();
      await open.waitFor({ timeout: 15000 });
      await open.click();
      await page.waitForTimeout(8000);
    },
  },
  { name: "backups", nav: "Backups", url: /\/backups/, budget: "Envelope", instance: true },
  { name: "automations", nav: "Automations", url: /\/automations/, budget: "Envelope", instance: true },
  {
    name: "budget-file-sync",
    nav: "Budget File Sync",
    url: /\/sync/,
    budget: "Envelope",
    // A flow moves data between two budgets and cannot reach either without a
    // live connection to both - and connections are per-session, held in
    // memory. The flow itself is seeded; the connections have to be made again
    // here or the flow reads "Needs connection".
    alsoConnect: "Tracking",
    instance: true,
    prepare: async (page) => {
      await page.getByText("Household card → archive").click();
      await page.waitForTimeout(5000);
      // "Sync preview", not "Preview": the button says what it previews.
      const preview = page.getByRole("button", { name: /Sync preview/ }).first();
      await preview.waitFor({ timeout: 20000 });
      await preview.click();
      // A preview reads both budgets and classifies every row; it writes
      // nothing, which is why it is safe to leave the flow in this state.
      await page.waitForTimeout(35000);
    },
  },
  {
    name: "fx-rates",
    nav: "FX Rates",
    url: /\/fx-rates/,
    budget: "Envelope",
    instance: true,
    /*
     * The pair is added here rather than by the seeder because a manually added
     * pair does not survive a page load: the pairs that persist are derived
     * from sync flows that convert currency, and one added by hand lives in the
     * page's own state. So it is added, given a rate, and photographed without
     * leaving.
     */
    prepare: async (page) => {
      await page.getByRole("button", { name: /pair$/ }).click();
      await page.getByLabel("New base currency").fill("EUR");
      await page.getByLabel("New quote currency").fill("USD");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.waitForTimeout(2500);

      // The provider first, so the override that follows sits alongside real
      // rates rather than against them: a hand-typed rate a long way off the
      // market puts a cliff in the chart and makes the page look wrong.
      const fill = page.getByRole("button", { name: /Fill range from Frankfurter/ });
      if (await fill.count()) {
        await fill.click();
        await page.waitForTimeout(15000);
      }

      // One rate of our own, so the source badges show both kinds.
      const today = new Date().toISOString().slice(0, 10);
      await page.getByLabel("Override date").fill(today);
      await page.getByLabel("Override rate").fill("1.1700");
      await page.getByRole("button", { name: "Save rate" }).click();
      await page.waitForTimeout(5000);
    },
  },
  {
    name: "actualql",
    nav: "ActualQL Queries",
    url: /\/query/,
    budget: "Envelope",
    // A query nobody has run shows "Run a query to see results here", which is
    // a picture of an empty pane rather than of the feature.
    prepare: async (page) => {
      await page.getByText("Latest 20 transactions", { exact: true }).click();
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.getByRole("table").first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(2500);
    },
  },
  { name: "budget-file-health", nav: "Budget File Health", url: /\/budget-diagnostics/, budget: "Envelope" },
  { name: "data-browser", nav: "Data Browser", url: /\/data-browser/, budget: "Envelope" },
  { name: "accounts", nav: "Accounts", url: /\/accounts/, budget: "Envelope" },
  { name: "payees", nav: "Payees", url: /\/payees$/, budget: "Envelope" },
  { name: "categories", nav: "Categories", url: /\/categories/, budget: "Envelope" },
  { name: "schedules", nav: "Schedules", url: /\/schedules/, budget: "Envelope" },
  { name: "tags", nav: "Tags", url: /\/tags/, budget: "Envelope" },

  /*
   * Dialogs. Each is photographed as itself rather than as a dimmed page, and
   * only where the dialog *is* the feature - a form with two labelled fields is
   * better described in a sentence than shown.
   */
  {
    name: "connect",
    area: "getting-started",
    preConnect: true,
    budget: "Envelope",
    instance: true,
  },
  {
    name: "app-health",
    area: "administration",
    nav: "App Health",
    url: /\/app-health/,
    budget: "Envelope",
    instance: true,
  },
  {
    name: "dialog-month-transactions",
    area: "dialogs",
    nav: "Budget",
    url: /\/budget-management/,
    budget: "Envelope",
    element: '[role="dialog"]',
    // The month summary's Spent figure is a link into the transactions behind
    // it - the answer to "spent on what", one click from the number that
    // prompted the question.
    prepare: async (page) => {
      await selectCurrentMonth(page);
      await page.getByLabel(/View expense transactions for/).click();
      // The dialog queries the month's transactions and builds its analytics
      // before it has anything to show.
      await page.waitForTimeout(12000);
    },
  },
  {
    name: "dialog-variance-drivers",
    area: "dialogs",
    nav: "Budget",
    url: /\/budget-management/,
    budget: "Tracking",
    element: '[role="dialog"]',
    // The month summary answers "how far off plan is this month"; this dialog
    // answers "because of what", which is the question a reader actually has.
    // The expense side, because that is where a month usually goes wrong.
    prepare: async (page) => {
      await selectCurrentMonth(page);
      await page.getByLabel("View variance drivers").last().click();
      await page.waitForTimeout(5000);
      // Expanded, because the groups alone say which part of the month drifted
      // and the categories underneath say what actually did it - and because
      // nine collapsed rows leave two thirds of the dialog empty.
      await page.getByRole("button", { name: /Expand all/ }).click();
      await page.waitForTimeout(3000);
    },
  },
  {
    name: "dialog-bundle-export",
    area: "dialogs",
    nav: "Overview",
    url: /\/overview/,
    budget: "Envelope",
    element: '[role="dialog"]',
    prepare: async (page) => {
      await page.getByRole("button", { name: /Export Bundle/ }).click();
      await page.waitForTimeout(4000);
    },
  },
  {
    name: "dialog-merge-rules",
    area: "dialogs",
    nav: "Rule Diagnostics",
    url: /\/rules\/diagnostics/,
    budget: "Envelope",
    element: '[role="dialog"]',
    prepare: async (page) => {
      await page.getByRole("button", { name: /Merge 2 rules/ }).first().click();
      await page.waitForURL(/\/rules/, { timeout: 30000 });
      await page.waitForTimeout(6000);
    },
  },
  {
    name: "dialog-payee-merge",
    area: "dialogs",
    nav: "Payees",
    url: /\/payees$/,
    budget: "Envelope",
    element: '[role="dialog"]',
    prepare: async (page) => {
      await page.getByPlaceholder("Search…").fill("Amazon");
      await page.waitForTimeout(2000);
      const rows = page.getByRole("checkbox");
      await rows.nth(1).check();
      await rows.nth(2).check();
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: /Merge/ }).first().click();
      await page.waitForTimeout(4000);
    },
  },
  {
    name: "dialog-backup-rule",
    area: "dialogs",
    nav: "Backups",
    url: /\/backups/,
    budget: "Envelope",
    instance: true,
    element: '[role="dialog"]',
    prepare: async (page) => {
      const setup = page.getByRole("tab", { name: "Setup" });
      if (await setup.count()) await setup.click();
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "New backup rule" }).first().click();
      await page.waitForTimeout(3000);
    },
  },
  {
    name: "dialog-flow-editor",
    area: "dialogs",
    nav: "Budget File Sync",
    url: /\/sync/,
    budget: "Envelope",
    alsoConnect: "Tracking",
    instance: true,
    element: '[role="dialog"]',
    prepare: async (page) => {
      await page.getByText("Household card → archive").click();
      await page.waitForTimeout(3000);
      await page.getByRole("button", { name: /Edit flow/ }).first().click();
      await page.waitForTimeout(3000);
    },
  },
  {
    name: "dialog-new-bank-sync",
    area: "dialogs",
    nav: "Automations",
    url: /\/automations/,
    budget: "Envelope",
    instance: true,
    element: '[role="dialog"]',
    prepare: async (page) => {
      await page.getByRole("button", { name: /New automation/ }).first().click();
      await page.waitForTimeout(1500);
      await page.getByRole("menuitem", { name: /Bank sync/ }).click();
      await page.waitForTimeout(3000);
    },
  },
  {
    name: "payee-cleanup-needs-rule",
    nav: "Payee Cleanup",
    url: /\/payees\/cleanup/,
    budget: "Envelope",
    prepare: async (page) => {
      await page.getByRole("button", { name: /Needs a rule/ }).click();
      await page.waitForTimeout(4000);
    },
  },
];

const args = process.argv.slice(2);
const includeInstance = args.includes("--include-instance");
const serveOwn = args.includes("--serve");
const wanted = args.filter((arg) => !arg.startsWith("--"));
const shots = (wanted.length > 0 ? SHOTS.filter((s) => wanted.includes(s.name)) : SHOTS).filter(
  (shot) => includeInstance || !shot.instance
);

/**
 * Where to point the app, and with what key.
 *
 * By default it asks the demo UI, which publishes both to every visitor - so no
 * credential is committed here. That endpoint sits behind the same bot
 * checkpoint as the rest of the demo host, though, and the checkpoint does not
 * always distinguish a script from a browser, so `DEMO_API_URL` and
 * `DEMO_API_KEY` override it when it will not answer.
 */
async function demoConnection() {
  if (process.env.DEMO_API_URL && process.env.DEMO_API_KEY) {
    return {
      baseUrl: process.env.DEMO_API_URL,
      apiKey: process.env.DEMO_API_KEY,
      budgets: [
        { label: "Live Demo - Envelope" },
        { label: "Live Demo - Tracking" },
      ],
    };
  }
  const response = await fetch(`${DEMO_UI}/api/demo`);
  if (!response.ok) {
    throw new Error(
      `${DEMO_UI}/api/demo answered ${response.status}. Set DEMO_API_URL and ` +
        "DEMO_API_KEY to the demo backend instead (both are public)."
    );
  }
  return response.json();
}

/** Connect the app to a demo budget through the form, as a reader would. */
/**
 * Where an image lands: `screenshots/<area>/<name>.png`.
 *
 * The area mirrors the documentation tree - `docs-site/README.md` asks for it -
 * so an image sits beside the pages that use it rather than in one flat pile of
 * thirty.
 */
async function shotPath(shot) {
  const dir = join(outDir, shot.area ?? "user-guide");
  await mkdir(dir, { recursive: true });
  return join(dir, `${shot.name}.png`);
}

/** Leave the page as the next shot expects to find it. */
async function closeAnyDialog(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await page.locator('[role="dialog"]').count()) === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }
}

async function openBudget(context, demo, mode) {
  const budget = demo.budgets.find((b) => b.label.toLowerCase().includes(mode.toLowerCase()));
  if (!budget) throw new Error(`the demo has no ${mode} budget`);

  const page = await context.newPage();
  await page.goto(`${appUrl}/connect`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // An instance with saved servers shows them first; the form is behind this.
  const addServer = page.getByRole("button", { name: "Add a server" });
  if (await addServer.count()) {
    await addServer.click();
    await page.waitForTimeout(1000);
  }

  await page.getByPlaceholder("https://budgetapi.example.com").fill(demo.baseUrl);
  await page.getByLabel("API Key").fill(demo.apiKey);
  await page.getByRole("button", { name: "Load budgets" }).click();

  // Two steps, not one: the budget row selects, and the panel's own Connect
  // button opens it. `exact` matters - every saved connection row on an
  // established instance also carries the word Connect.
  const entry = page.getByRole("button", { name: new RegExp(budget.label) });
  await entry.first().waitFor({ timeout: 60000 });
  await entry.first().click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.waitForURL(/\/overview/, { timeout: 60000 });
  // The first view downloads the budget; everything after it is warm.
  await page.waitForTimeout(6000);
  return page;
}

/**
 * An instance of our own, and everything it needs to be worth photographing.
 *
 * Its own database (empty, thrown away afterwards), its own build directory (so
 * it can run beside a development server that is already up), and a vault key
 * (without one the pages carry a banner about unattended access being
 * unconfigured, which is true of the instance and not of the product).
 */
/**
 * A port nothing is holding.
 *
 * Bindability, not "does it answer": a wedged server from an interrupted run
 * holds its port while answering nothing, and an HTTP probe reads that as free.
 * The new server then cannot bind, never becomes ready, and the run fails with
 * a timeout that says nothing about why.
 */
async function freePort(from) {
  const { createServer } = await import("node:net");
  for (let port = from; port < from + 12; port++) {
    const available = await new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (available) return port;
  }
  throw new Error(`no free port between ${from} and ${from + 11}`);
}

async function startOwnInstance() {
  const dataDir = await mkdtemp(join(tmpdir(), "bench-shots-"));
  const port = process.env.SHOT_PORT ? Number(process.env.SHOT_PORT) : await freePort(3999);
  // Its own process group, so stopping it stops the server rather than the
  // wrapper that spawned it - a killed wrapper leaves the dev server running,
  // holding both the port and the build directory, and the next run cannot
  // start at all.
  const server = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: join(here, "..", ".."),
    detached: true,
    env: {
      ...process.env,
      // Per port, for the same reason: two runs must never share one.
      ACTUAL_BENCH_DIST_DIR: `.next-shots/${port}`,
      ACTUAL_BENCH_DB_PATH: join(dataDir, "actual-bench.sqlite"),
      SYNC_VAULT_KEY: process.env.SYNC_VAULT_KEY ?? "documentation-screenshots-vault-key",
    },
    stdio: "ignore",
  });

  // `localhost`, never `127.0.0.1`: Next 16 refuses dev-server infrastructure
  // from other origins, and the page then renders without ever hydrating - it
  // looks fine and no button works.
  const url = `http://localhost:${port}`;
  // Generous: the first compile after a clean checkout, with no build cache,
  // takes minutes on a modest machine.
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/connect`);
      if (response.ok) {
        return {
          url,
          stop: async () => {
            // The group, then the group again with prejudice: `next dev` spawns
            // a `next-server` child that outlives a polite signal, and an
            // orphan holds both its port and about a gigabyte of memory - which
            // is enough to crash the browser of the next run.
            const signal = (sig) => {
              try {
                process.kill(-server.pid, sig);
              } catch {
                server.kill(sig);
              }
            };
            signal("SIGTERM");
            await new Promise((resolve) => setTimeout(resolve, 2000));
            signal("SIGKILL");
            await rm(dataDir, { recursive: true, force: true });
          },
        };
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    server.kill("SIGKILL");
  }
  throw new Error(`the instance did not start on ${url}`);
}

function runSeeder(appUrl, demo) {
  return new Promise((resolve, reject) => {
    const seeder = spawn(process.execPath, [join(here, "seed-screenshot-fixtures.mjs")], {
      env: { ...process.env, APP_URL: appUrl, DEMO_API_URL: demo.baseUrl, DEMO_API_KEY: demo.apiKey },
      stdio: "inherit",
    });
    seeder.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seeding failed (${code})`))));
  });
}

async function main() {
  let instance = null;
  let succeeded = false;
  try {
    succeeded = await run((own) => {
      instance = own;
    });
  } finally {
    // Without this, a failure anywhere - seeding, a selector, a bad shot -
    // leaves a development server running, holding its port and its build
    // directory, and every later run has to work around it.
    if (instance) await instance.stop();
  }
  // After the cleanup, never before it.
  process.exitCode = succeeded ? 0 : 1;
}

async function run(registerInstance) {
  await mkdir(outDir, { recursive: true });
  const demo = await demoConnection();
  // `--serve` is the whole pipeline: an instance of our own, seeded, captured,
  // torn down. Without it the script photographs whatever APP_URL points at,
  // which must not be somebody's working install if instance pages are wanted.
  let own = null;
  if (serveOwn) {
    console.log("starting an instance of our own...");
    own = await startOwnInstance();
    registerInstance(own);
    appUrl = own.url;
    // Seeding exists for the instance pages; skip it when none were asked for,
    // since it costs a couple of minutes and a real backup run.
    if (shots.some((shot) => shot.instance)) await runSeeder(appUrl, demo);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  // A development build paints its own overlay button over the sidebar, and it
  // is not part of the product.
  await context.addInitScript(() => {
    const style = document.createElement("style");
    // The development overlay button is not part of the product, and a toast is
    // a thing that was happening rather than a thing that is true - both belong
    // out of a screenshot.
    style.textContent =
      "nextjs-portal, #__next-dev-overlay, [data-sonner-toaster] { display: none !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  });

  const pages = new Map();
  const connected = new Set();
  const failures = [];

  for (const shot of shots) {
    try {
      if (shot.preConnect) {
        // Before any budget is opened: this is what a first run looks like, and
        // it cannot be photographed once a connection exists.
        const fresh = await context.newPage();
        await fresh.goto(`${appUrl}/connect`, { waitUntil: "domcontentloaded" });
        await fresh.getByPlaceholder("https://budgetapi.example.com").waitFor({ timeout: 120000 });
        await fresh.waitForTimeout(2500);
        const scope = shot.element ? fresh.locator(shot.element).first() : fresh;
        await scope.screenshot({ path: await shotPath(shot) });
        await fresh.close();
        console.log(`captured ${shot.name}`);
        continue;
      }

      if (!pages.has(shot.budget)) pages.set(shot.budget, await openBudget(context, demo, shot.budget));
      const page = pages.get(shot.budget);

      if (shot.alsoConnect && !connected.has(shot.alsoConnect)) {
        // Its credentials, not the environment's: the capture resolves them
        // from the demo endpoint when they are not set, and the seeder module
        // has no way to know that.
        await connectSecondBudget(page, shot.alsoConnect, demo);
        connected.add(shot.alsoConnect);
        // Connecting the second budget makes it the active one, and every later
        // shot would then be labelled with it in the top bar. Switch back, so
        // the images agree with each other about which budget is open.
        await page.getByRole("button", { name: new RegExp(`Live Demo - ${shot.alsoConnect}`) }).first().click();
        await page.waitForTimeout(800);
        await page.getByRole("menuitem", { name: new RegExp(`Live Demo - ${shot.budget}`) }).click();
        await page.waitForTimeout(4000);
      }

      const link = page.getByRole("link", { name: shot.nav, exact: true }).first();
      await link.waitFor({ timeout: 30000 });
      await link.click();
      await page.waitForURL(shot.url, { timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      // Tables and charts settle once their queries resolve. A fixed pause beats
      // a selector per page, and a screenshot of a spinner is obvious enough to
      // catch by eye.
      await page.waitForTimeout(5000);
      // Some pages only show what they are for once they have been asked to do
      // something.
      if (shot.prepare) await shot.prepare(page);

      // A dialog photographed as a whole page is mostly dimmed background, so a
      // shot can name the element it is actually about.
      const target = shot.element ? page.locator(shot.element).first() : page;
      await target.screenshot({ path: await shotPath(shot) });
      console.log(`captured ${shot.name}`);

      // Shots share one page, so a dialog left open blocks the next one's
      // sidebar click - which failed five shots in a row and reported it as a
      // missing sidebar link.
      await closeAnyDialog(page);
    } catch (error) {
      console.log(`FAILED   ${shot.name}: ${error?.message ?? error}`);
      failures.push(shot.name);
    }
  }

  await browser.close();
  if (failures.length > 0) {
    console.log(`\n${failures.length} shot(s) failed: ${failures.join(", ")}`);
    // Reported, not exited: `process.exit` here would end the process while
    // main() is still awaiting this call, so its `finally` would never stop the
    // instance - leaving a dev server holding the port and the build directory,
    // which is exactly what a failed run used to do.
    return false;
  }
  console.log(`\n${shots.length} screenshots written to ${outDir}`);
  return true;
}

await main();
