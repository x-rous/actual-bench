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

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const APP_URL = (process.env.APP_URL ?? "http://localhost:3999").replace(/\/+$/, "");
const DEMO_API_URL = process.env.DEMO_API_URL;
const DEMO_API_KEY = process.env.DEMO_API_KEY;
/** Where the local backup destination writes. Disposable by design. */
const BACKUP_DIR = process.env.SHOT_BACKUP_DIR ?? "/tmp/actual-bench-doc-backups";

if (!DEMO_API_URL || !DEMO_API_KEY) {
  console.log("seed: DEMO_API_URL and DEMO_API_KEY are required.");
  process.exit(1);
}

export async function connectToDemo(page, mode = "Envelope") {
  await page.goto(`${APP_URL}/connect`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const addServer = page.getByRole("button", { name: "Add a server" });
  if (await addServer.count()) {
    await addServer.click();
    await page.waitForTimeout(800);
  }
  await page.getByPlaceholder("https://budgetapi.example.com").fill(DEMO_API_URL);
  await page.getByLabel("API Key").fill(DEMO_API_KEY);
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

  // Run it once, so the Backups tab has a verified copy to show rather than an
  // explanation of what one would look like.
  const runNow = page.getByRole("button", { name: "Back up now" }).first();
  if (await runNow.count()) {
    await runNow.click();
    // Wait for the rule to report a run rather than for a fixed time: a copy
    // that has not been taken yet leaves the page saying "never", which is the
    // one thing this fixture exists to avoid.
    await page
      .getByRole("row", { name: /Nightly backup/ })
      .filter({ hasNotText: "never" })
      .first()
      .waitFor({ timeout: 180000 })
      .catch(() => console.log("seed: WARNING - the backup run did not report a result"));
    await page.waitForTimeout(2000);
    console.log("seed: backup run finished");
  }
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
async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();

  try {
    await connectToDemo(page, "Envelope");
    await seedBackups(page);
    console.log("seed: done");
  } catch (error) {
    console.log(`seed: FAILED - ${error?.message ?? error}`);
    console.log("visible dialog:", await page.getByRole("dialog").innerText().catch(() => "(none)"));
    await browser.close();
    process.exit(1);
  }

  await browser.close();
}

await main();
