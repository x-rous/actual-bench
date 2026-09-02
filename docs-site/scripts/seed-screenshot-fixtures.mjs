#!/usr/bin/env node
/**
 * Give the screenshot instance something worth photographing.
 *
 * Most pages draw the connected budget, so the public demo supplies their
 * content. Four do not: Backups, Automations, Budget File Sync and FX Rates
 * read the *instance's own* metadata - its destinations, rules, flows and
 * rates - which on a fresh instance is empty, and on anybody's real instance is
 * private. Photographing a real one leaks their backup destinations and their
 * schedule; photographing an empty one shows a reader nothing.
 *
 * So the fixtures are created here, on a throwaway instance, and they are
 * created **through the interface** rather than by writing rows. The payload
 * shapes behind these pages are internal and will drift; the dialogs are the
 * contract. It costs a couple of minutes per run and buys a seeder that keeps
 * working, and that fails loudly when a flow it depends on breaks.
 *
 * Usage (see capture-screenshots.mjs, which runs this for you):
 *   APP_URL=http://localhost:3999 \
 *   DEMO_API_URL=... DEMO_API_KEY=... \
 *   node docs-site/scripts/seed-screenshot-fixtures.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const APP_URL = (process.env.APP_URL ?? "http://localhost:3999").replace(/\/+$/, "");
const DEMO_API_URL = process.env.DEMO_API_URL;
const DEMO_API_KEY = process.env.DEMO_API_KEY;
/** Where the local backup destination writes. Disposable by design. */
const BACKUP_DIR = process.env.SHOT_BACKUP_DIR ?? "/tmp/actual-bench-doc-backups";

/**
 * Credentials for a demo request, from the caller or from the environment.
 *
 * Not checked at import: the capture script imports `connectSecondBudget` from
 * here, and a guard at module scope ended that process before it had resolved
 * the credentials it was about to pass in.
 */
function credentials(given) {
  const baseUrl = given?.baseUrl ?? DEMO_API_URL;
  const apiKey = given?.apiKey ?? DEMO_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("the demo's base URL and API key are required (DEMO_API_URL, DEMO_API_KEY)");
  }
  return { baseUrl, apiKey };
}

/** The demo's connection details, for the fixtures that need to read from it. */
const demo = {
  baseUrl: DEMO_API_URL,
  apiKey: DEMO_API_KEY,
  budgets: [
    { label: "Live Demo - Envelope", budgetSyncId: process.env.DEMO_ENVELOPE_SYNC_ID ?? "7d243b3e-d2dc-4863-be75-b1fd85b77c2b" },
    { label: "Live Demo - Tracking", budgetSyncId: process.env.DEMO_TRACKING_SYNC_ID ?? "5e48dea9-96ef-4f5e-ba26-10a5af1e4da2" },
  ],
};

/**
 * Read a demo API answer, or say why it cannot be read.
 *
 * Without the status check a rejected request fails later and elsewhere: an
 * expired key or a rate limit leaves `data` undefined, so the next line throws
 * about a property of undefined, and an HTML error page makes `json()` throw a
 * syntax error. Neither names the request that actually failed.
 */
async function demoJson(response, what) {
  if (!response.ok) {
    throw new Error(`the demo backend answered ${response.status} for ${what}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`the demo backend did not return JSON for ${what}`);
  }
}

export async function connectToDemo(page, mode = "Envelope", given) {
  const { baseUrl, apiKey } = credentials(given);
  await page.goto(`${APP_URL}/connect`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const addServer = page.getByRole("button", { name: "Add a server" });
  if (await addServer.count()) {
    await addServer.click();
    await page.waitForTimeout(800);
  }
  // The first view of a freshly started instance compiles as it loads, which
  // can take well past a default timeout.
  const urlField = page.getByPlaceholder("https://budgetapi.example.com");
  await urlField.waitFor({ timeout: 120000 });
  await urlField.fill(baseUrl);
  await page.getByLabel("API Key").fill(apiKey);
  await page.getByRole("button", { name: "Load budgets" }).click();

  const entry = page.getByRole("button", { name: new RegExp(`Live Demo - ${mode}`) });
  await entry.first().waitFor({ timeout: 60000 });
  await entry.first().click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.waitForURL(/\/overview/, { timeout: 60000 });
  await page.waitForTimeout(5000);
}

async function openTool(page, name, urlPattern) {
  const link = page.getByRole("link", { name, exact: true }).first();
  await link.waitFor({ timeout: 30000 });
  await link.click();
  await page.waitForURL(urlPattern, { timeout: 30000 });
  await page.waitForTimeout(3000);
}

/** A folder to write to, and a rule that writes to it every night. */
async function seedBackups(page) {
  await mkdir(BACKUP_DIR, { recursive: true });
  await openTool(page, "Backups", /\/backups/);

  // Idempotent: the button is always there, so the question is whether the row
  // is. Re-running the seeder against a database that already has fixtures used
  // to add a fourth identical destination.
  if (await page.getByRole("cell", { name: "Server folder" }).count()) {
    console.log("seed: backups already seeded, leaving it alone");
    return;
  }
  await page.getByRole("button", { name: "Add destination" }).click();
  await page.waitForTimeout(1500);

  // By placeholder, not by label: the dialog's labels are not associated with
  // their inputs, so `getByLabel` finds nothing to type into.
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("NAS volume").fill("Server folder");
  await dialog.getByPlaceholder("/data/backups").fill(BACKUP_DIR);
  // "Add and test": the dialog writes to the destination on save, because a
  // destination nobody has written to is a guess.
  await dialog.getByRole("button", { name: "Add and test" }).click();
  await page.waitForTimeout(9000);
  // The dialog stays open to show what the test found, so it has to be
  // dismissed before the page underneath is reachable again.
  const close = dialog.getByRole("button", { name: /^(Close|Done)$/ });
  if (await close.count()) await close.first().click();
  else await page.keyboard.press("Escape");
  await page.waitForTimeout(3000);
  console.log("seed: destination added");

  await page.getByRole("button", { name: "New backup rule" }).first().click();
  await page.waitForTimeout(1500);
  const ruleDialog = page.getByRole("dialog");
  console.log("seed: rule dialog reads -", (await ruleDialog.innerText()).replace(/\n+/g, " | ").slice(0, 400));
  await ruleDialog.locator("input").first().fill("Nightly backup");
  // A rule that runs on the server needs credentials the server can use, and
  // the dialog offers the enrolment inline. Without it "Create rule" stays
  // disabled and the reason is a sentence above the button.
  const enrol = ruleDialog.getByRole("button", { name: /^Enrol / });
  if (await enrol.count()) {
    await enrol.first().click();
    await page.waitForTimeout(4000);
  }
  // Destinations come pre-ticked; the time does not, and "Create rule" stays
  // disabled without one.
  await ruleDialog.locator('input[type="time"]').first().fill("21:00");
  await page.waitForTimeout(500);
  await ruleDialog.getByRole("button", { name: "Create rule" }).click();
  await page.waitForTimeout(8000);
  console.log("seed: backup rule added");

  // Run it once, so the Backups tab holds a verified copy rather than an
  // explanation of what one would look like. Not optional: a missing button is
  // a failure here, not something to skip past and photograph anyway.
  const runNow = page.getByRole("button", { name: "Back up now" }).first();
  await runNow.waitFor({ timeout: 30000 });
  await runNow.click();
  // Wait for the rule to report a run rather than for a fixed time: a copy that
  // has not been taken yet leaves the page saying "never", which is the one
  // thing this fixture exists to avoid.
  await page
    .getByRole("row", { name: /Nightly backup/ })
    .filter({ hasNotText: "never" })
    .first()
    .waitFor({ timeout: 180000 });
  await page.waitForTimeout(2000);
  console.log("seed: backup run finished");
}

/**
 * Still to seed, and why each is more than a line of code:
 *
 *   * **a sync flow** - needs both demo budgets connected at once, then a
 *     preview run so the review queue has rows in it;
 *   * **exchange rates** - needs a converting flow first, and a range filled
 *     from the rate provider, so it depends on the flow above;
 *   * **a reconciliation session** - needs a statement to import. Generating
 *     one from the demo budget's own transactions, with a few deliberate
 *     differences, would show the matching workbench doing its job rather than
 *     an empty page.
 *
 * Until they exist, those pages are left out of the documentation rather than
 * illustrated with an empty state, which teaches a reader nothing.
 */
/**
 * A statement to reconcile against, built from the demo budget's own history.
 *
 * Deliberately imperfect: most rows match, two amounts differ, two rows are on
 * the statement and not in the budget, and a few budget transactions are absent
 * from the statement. A reconciliation where everything matches is a picture of
 * a table; the differences are the feature.
 */
export async function writeStatement(demo, budgetSyncId, accountId) {
  const since = new Date(Date.now() - 75 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const response = await fetch(
    `${demo.baseUrl}/v1/budgets/${budgetSyncId}/accounts/${accountId}/transactions?since_date=${since}`,
    { headers: { "x-api-key": demo.apiKey } }
  );
  const rows = (await demoJson(response, "transactions")).data ?? [];
  if (rows.length === 0) throw new Error("the demo account returned no transactions");

  const statement = rows
    .slice(0, 40)
    .map((row, index) => {
      const amount = index === 3 || index === 11 ? row.amount + 250 : row.amount;
      return {
        date: row.date,
        description: row.imported_payee ?? row.payee_name ?? "Payment",
        amount: (amount / 100).toFixed(2),
      };
    })
    // Two the budget has never seen.
    .concat([
      { date: rows[0].date, description: "ATLAS PARKING GARAGE", amount: "-18.00" },
      { date: (rows[1] ?? rows[0]).date, description: "COUNTY LIBRARY FINE", amount: "-4.50" },
    ]);

  const csv = ["Date,Description,Amount"]
    .concat(statement.map((row) => `${row.date},"${row.description}",${row.amount}`))
    .join("\n");
  const path = join(tmpdir(), "demo-statement.csv");
  await writeFile(path, csv, "utf8");
  console.log(`seed: statement written with ${statement.length} rows`);
  return path;
}

/** A reconciliation session, mid-review, with the differences visible. */
async function seedReconciliation(page, demo) {
  await openTool(page, "Bank Reconciliation", /\/reconciliation/);
  if (await page.getByRole("cell", { name: /Household Checking/ }).count()) {
    console.log("seed: a reconciliation session already exists, leaving it alone");
    return;
  }

  const budget = demo.budgets.find((b) => /envelope/i.test(b.label));
  const accounts = await fetch(
    `${demo.baseUrl}/v1/budgets/${budget.budgetSyncId ?? budget.syncId}/accounts`,
    { headers: { "x-api-key": demo.apiKey } }
  ).then((r) => demoJson(r, "accounts"));
  const account = accounts.data.find((a) => a.name === "Household Checking") ?? accounts.data[0];
  const statementPath = await writeStatement(demo, budget.budgetSyncId ?? budget.syncId, account.id);

  await page.getByRole("button", { name: /New reconciliation|Start reconciliation/ }).first().click();
  await page.waitForTimeout(1500);
  // A searchable combobox, not a select: six accounts is fine in a dropdown and
  // sixty is not, so the control types rather than opens.
  // The combobox is a button that opens a listbox with its own search field -
  // the placeholder is the button's text, not an input's.
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Select an account/ }).click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder("Search…").fill(account.name);
  await page.waitForTimeout(900);
  await page.getByRole("option", { name: account.name }).first().click();
  await page.getByPlaceholder("July close").fill("August close");
  await dialog.getByRole("button", { name: "Start" }).click();
  await page.waitForTimeout(4000);

  await page.locator('input[type="file"]').setInputFiles(statementPath);
  await page.waitForTimeout(7000);

  // Import is the phase where columns are confirmed; the workbench everyone
  // means by "reconciliation" is the one after it.
  const match = page.getByRole("button", { name: /Match against Actual/ });
  await match.first().waitFor({ timeout: 30000 });
  await match.first().click();
  await page.waitForTimeout(12000);
  console.log("seed: reconciling -", (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 260));
}

/**
 * A second budget, connected alongside the first.
 *
 * A sync flow moves data between two budgets, so one connection is not enough.
 * Both live in the browser session, which is also how a real user ends up with
 * two: connect, work, connect the other.
 */
export async function connectSecondBudget(page, mode = "Tracking", given) {
  const { baseUrl, apiKey } = credentials(given);
  // Through the app, never `page.goto`: connections are held in memory only -
  // deliberately, so API keys are never written to browser storage - and a full
  // page load throws away the budget already connected. The top bar's
  // "Add connection…" routes there client-side and keeps it.
  await page.getByRole("button", { name: /Live Demo/ }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("menuitem", { name: /Add connection/ }).click();
  await page.waitForURL(/\/connect/, { timeout: 30000 });
  await page.waitForTimeout(2500);

  const addServer = page.getByRole("button", { name: "Add a server" });
  if (await addServer.count()) {
    await addServer.click();
    await page.waitForTimeout(800);
  }
  const urlField = page.getByPlaceholder("https://budgetapi.example.com");
  if (await urlField.count()) {
    await urlField.fill(baseUrl);
    await page.getByLabel("API Key").fill(apiKey);
    await page.getByRole("button", { name: "Load budgets" }).click();
  }

  const entry = page.getByRole("button", { name: new RegExp(`Live Demo - ${mode}`) });
  await entry.first().waitFor({ timeout: 60000 });
  await entry.first().click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.waitForURL(/\/overview/, { timeout: 60000 });
  await page.waitForTimeout(5000);
  console.log(`seed: second budget connected (${mode})`);
}

/** A transactions flow between the two demo budgets, previewed but not applied. */
async function seedSyncFlow(page) {
  await openTool(page, "Budget File Sync", /\/sync/);
  if (!(await page.getByText("No sync flows yet").count())) {
    console.log("seed: a sync flow already exists, leaving it alone");
    return;
  }

  await page.getByRole("button", { name: /New (sync )?flow/ }).first().click();
  await page.waitForTimeout(2000);

  const dialog = page.getByRole("dialog");
  console.log(
    "seed: flow dialog selects -",
    await dialog.locator("select").evaluateAll((els) =>
      els
        .map((el) => `${el.getAttribute("aria-label")}=[${[...el.options].map((o) => o.label).join(", ")}]`)
        .join(" | ")
    )
  );
  await dialog.getByLabel("Flow name").fill("Household card → archive");
  await dialog.getByLabel("Source connection").selectOption({ label: "Live Demo - Envelope" });
  await page.waitForTimeout(2500);
  await dialog.getByLabel("Source account").selectOption({ label: "Household Checking" });
  await dialog.getByLabel("Target connection").selectOption({ label: "Live Demo - Tracking" });
  await page.waitForTimeout(2500);
  await dialog.getByLabel("Target account").selectOption({ label: "Household Checking" });
  await dialog.getByRole("button", { name: /Save flow/ }).click();
  await page.waitForTimeout(6000);
  console.log("seed: sync flow created");

  // Preview writes nothing - it classifies, which is the thing worth showing.
  const preview = page.getByRole("button", { name: "Preview", exact: true }).first();
  if (await preview.count()) {
    await preview.click();
    await page.waitForTimeout(30000);
  }
  console.log("seed: sync preview -", (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 240));
}

async function main() {
  credentials();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();

  try {
    await connectToDemo(page, "Envelope");
    await seedBackups(page);
    await seedReconciliation(page, demo);
    await connectSecondBudget(page, "Tracking");
    await seedSyncFlow(page);
    console.log("seed: done");
  } catch (error) {
    console.log(`seed: FAILED - ${error?.message ?? error}`);
    console.log("visible dialog:", await page.getByRole("dialog").innerText().catch(() => "(none)"));
    await browser.close();
    process.exit(1);
  }

  await browser.close();
}

// Only when run directly. The capture script imports `connectSecondBudget`
// from here, and an unguarded call would seed a second time - against whatever
// APP_URL happened to be set - the moment the module loaded.
if (process.argv[1] && process.argv[1].endsWith("seed-screenshot-fixtures.mjs")) {
  await main();
}
