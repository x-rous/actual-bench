#!/usr/bin/env node
/**
 * Capture the documentation screenshots for every page outside Financial
 * Management (those are capture-guides.mjs): getting started, Budget Setup, the
 * Budget Cockpit grid, Analyze & Cleanup, Bank Reconciliation, Sync &
 * Automations and App Health.
 *
 *   node docs-site/scripts/capture-pages.mjs              # everything
 *   node docs-site/scripts/capture-pages.mjs setup recon  # named groups
 *
 * Groups: start, setup, cockpit, tools, recon, ops.
 *
 * Every shot is cropped to what the page is for: the sidebar and top bar stay
 * out, a table is cut where its rows end, and a dialog or panel is photographed
 * on its own. A whole-window screenshot shrinks to unreadable in a text column,
 * and its sidebar dates the image the next time a page is renamed.
 *
 * `recon` and `ops` create things - a reconciliation session from a PDF
 * statement, a backup, a sync flow - so they only run against a local seed
 * (BENCH_URL, see docs/screenshots.md), never the shared public demo. Before
 * running them, start the local Bench on a fresh copy of the seed database and
 * make sure the seed's backup folder (/data/backups) exists and is writable.
 *
 * Requires Playwright's Chromium (`npx playwright install chromium-headless-shell`).
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rename, writeFile } from "node:fs/promises";
import {
  DEMO,
  VIEWPORT,
  belowChrome,
  closeDialog,
  connectSecond,
  groupsWanted,
  isLocal,
  nav,
  openCockpitMonth,
  openDemo,
  shooter,
  storyMonth,
  tab,
} from "./demo-capture.mjs";
import { writeDemoStatement } from "./demo-statement.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src", "assets", "screenshots");
const want = groupsWanted();
const guide = await shooter(join(root, "user-guide"));
const start = await shooter(join(root, "getting-started"));
const dialogs = await shooter(join(root, "dialogs"));
const admin = await shooter(join(root, "administration"));
const { browser, page } = await openDemo();
const dialog = () => page.locator('[role="dialog"]').first();
const failures = [];

/** One shot; a failure is reported (with a picture, if asked) and the run carries on. */
async function step(name, work) {
  try {
    await work();
  } catch (error) {
    console.log(`FAILED   ${name}: ${String(error?.message ?? error).split("\n")[0]}`);
    failures.push(name);
    if (process.env.SHOT_DEBUG_DIR) {
      await page.screenshot({ path: join(process.env.SHOT_DEBUG_DIR, `${name}-failed.png`) }).catch(() => {});
    }
    await closeDialog(page);
    // A shot that failed after staging an edit must not leave it for the next one.
    await discardDraft().catch(() => {});
  }
}

/** Budget Setup tables at a laptop width, so their text is not lost in a wide, sparse row. */
const TABLE_VIEWPORT = { width: 1440, height: 900 };
async function withViewport(size, work) {
  await page.setViewportSize(size);
  await page.waitForTimeout(1500);
  try {
    await work();
  } finally {
    await page.setViewportSize(VIEWPORT);
    await page.waitForTimeout(1000);
  }
}

/**
 * Photograph below the chrome, down to the lowest text right of the sidebar, so
 * a short grid beside a tall panel is not followed by an empty band.
 */
async function shootContent(shooterFor, target, name, right = VIEWPORT.width) {
  const bottom = await target.evaluate(() => {
    let max = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.left > 208 && rect.width > 0 && rect.bottom <= window.innerHeight) max = Math.max(max, rect.bottom);
      }
    }
    return max;
  });
  return shooterFor.shoot(target, name, belowChrome(Math.min(1032, Math.ceil(bottom) + 20 - 48), right));
}

/** Where the page ends on the right: before the Changes panel if one is open. */
async function pageRight() {
  const panel = page.locator('[aria-label="Changes"], [aria-label="Changes minimized"]').first();
  const box = (await panel.count()) ? await panel.boundingBox() : null;
  return box && box.x > 400 ? Math.floor(box.x) : 1880;
}

/** The nth row of the page's main table, counting from 0. */
const row = (n) => page.locator("main tbody tr, main [role='row']").nth(n);

/** Discard whatever a shot staged, so the next shot starts from the saved budget. */
async function discardDraft() {
  const discard = page.getByRole("button", { name: "Discard", exact: true }).first();
  if (await discard.isVisible().catch(() => false)) {
    await discard.click();
    await page.waitForTimeout(2500);
    const confirm = page.locator('[role="alertdialog"]').getByRole("button", { name: /Discard/ });
    if (await confirm.count()) {
      await confirm.first().click();
      await page.waitForTimeout(2000);
    }
  }
}

/** Rename a cell by double-clicking it, typing, and pressing Enter: a staged edit. */
async function renameCell(from, to) {
  await page.getByText(from, { exact: true }).first().dblclick();
  await page.waitForTimeout(700);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(to);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
}

try {
  if (want("start")) {
    await step("overview", async () => {
      await nav(page, "Overview", 6000);
      // The figures, Budget Setup and Financial Management: where every page is.
      const next = page.getByText(/^Sync & Automations$/i).last();
      const box = await next.boundingBox();
      await start.shoot(page, "overview", { x: 300, y: 56, width: 1528, height: Math.ceil(box.y) - 64 });
    });
    await step("dialog-bundle-export", async () => {
      await page.getByRole("button", { name: /Export Bundle/ }).click();
      await page.waitForTimeout(4000);
      await dialogs.element(dialog(), "dialog-bundle-export");
      await closeDialog(page);
    });
    await step("changes-panel", async () => {
      await nav(page, "Payees", 7000);
      await renameCell("AMZN Mktp", "Amazon Marketplace");
      await renameCell("Chevron", "Chevron Fuel");
      // Off the last cell, so no cell is drawn selected.
      await page.getByText("Payees", { exact: true }).first().click();
      await page.waitForTimeout(1500);
      // Edited rows marked in the table, and the Changes panel listing them
      // beside the Save button that writes them.
      await start.shootTo(page, "changes-panel", page.getByText("Chipotle", { exact: true }).first(), { pad: 9 });
      await discardDraft();
    });
    await step("usage-inspector", async () => {
      // A row's own Info button: what depends on this payee, before you change it.
      const target = page.getByText("Costco", { exact: true }).first();
      await target.hover();
      await page.waitForTimeout(600);
      const box = await target.boundingBox();
      const info = page.getByRole("button", { name: "Inspect usage" });
      let clicked = false;
      for (let i = 0; i < (await info.count()); i++) {
        const b = await info.nth(i).boundingBox();
        if (b && Math.abs(b.y + b.height / 2 - (box.y + box.height / 2)) < 12) {
          await info.nth(i).click();
          clicked = true;
          break;
        }
      }
      if (!clicked) throw new Error("no Info button on the Costco row");
      await page.waitForTimeout(3000);
      const panel = page.locator('[role="dialog"], aside').last();
      const top = await panel.boundingBox();
      const end = await panel.getByText(/View rules|View transactions/).last().boundingBox();
      await start.shoot(page, "usage-inspector", { x: top.x, y: top.y, width: top.width, height: Math.ceil(end.y + end.height - top.y) + 20 });
      await closeDialog(page);
    });
    await step("connect", async () => {
      // A first visit: a new browser, so no budget is connected yet.
      const fresh = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: "light" });
      try {
        const first = await fresh.newPage();
        await first.goto(`${(process.env.BENCH_URL ?? DEMO).replace(/\/+$/, "")}/connect`, { waitUntil: "domcontentloaded" });
        await first.locator("#baseUrl").or(first.getByPlaceholder(/budgetapi/)).first().waitFor({ timeout: 120000 });
        await first.waitForTimeout(2500);
        await start.element(first.locator('[class~="max-w-md"]').first(), "connect");
      } finally {
        await fresh.close();
      }
    });
    await step("about-feature", async () => {
      await nav(page, "Bank Reconciliation", 6000);
      await page.getByRole("button", { name: /^About Bank Reconciliation/ }).click();
      await page.waitForTimeout(1200);
      await start.element(page.getByLabel("Bank Reconciliation information"), "about-feature");
      await page.keyboard.press("Escape");
    });
  }

  if (want("setup")) {
    // Accounts has the most columns, so it keeps the full window.
    await step("accounts", async () => {
      await nav(page, "Accounts", 7000);
      await guide.shootTo(page, "accounts", page.getByText("Total", { exact: true }).last(), { right: 1880 });
    });
    await withViewport(TABLE_VIEWPORT, async () => {
      // The layers rail at the right edge is not part of the table.
      const right = TABLE_VIEWPORT.width - 40;
      for (const [label, name] of [
        ["Categories", "categories"],
        ["Payees", "payees"],
        ["Tags", "tags"],
        ["Schedules", "schedules"],
        ["Rules", "rules"],
      ]) {
        await step(name, async () => {
          await nav(page, label, 7000);
          // The last row that fits whole in the window: a cut row reads as a rendering fault.
          const all = page.locator("main tbody tr, main [role='row']");
          let last = null;
          for (let i = (await all.count()) - 1; i >= 0; i--) {
            const box = await all.nth(i).boundingBox();
            if (box && box.y + box.height <= TABLE_VIEWPORT.height - 70) {
              last = all.nth(i);
              break;
            }
          }
          if (!last) throw new Error("no table rows found");
          await guide.shootTo(page, name, last, { right, pad: 1 });
        });
      }
      await step("dialog-payee-merge", async () => {
        await nav(page, "Payees", 7000);
        await page.getByPlaceholder(/Search/).first().fill("Amazon");
        await page.waitForTimeout(2000);
        const boxes = page.locator("main tbody").getByRole("checkbox");
        await boxes.nth(0).check();
        await boxes.nth(1).check();
        await page.waitForTimeout(1000);
        await page.getByRole("button", { name: /Merge/ }).first().click();
        await page.waitForTimeout(4000);
        await dialogs.element(dialog(), "dialog-payee-merge");
        await closeDialog(page);
        await discardDraft();
      });
    });
  }

  if (want("cockpit")) {
    const month = storyMonth();
    await step("budget-envelope", async () => {
      await nav(page, "Budget Cockpit", 15000);
      await page.getByRole("button", { name: "Expand all groups" }).click();
      await page.waitForTimeout(3000);
      await shootContent(guide, page, "budget-envelope");
    });
    await step("budget-details-category", async () => {
      await page.locator('[aria-label="Category: Groceries"]').first().click();
      await page.waitForTimeout(5000);
      await shootContent(guide, page, "budget-details-category");
    });
    await step("budget-actuals", async () => {
      await page.getByRole("button", { name: "Actuals", exact: true }).click();
      await page.waitForTimeout(3000);
      await page.locator('[aria-label="Category: Restaurants"]').first().click();
      await page.waitForTimeout(5000);
      await shootContent(guide, page, "budget-actuals");
      await page.getByRole("button", { name: "Budgeted", exact: true }).click();
      await page.waitForTimeout(2000);
    });
    await step("budget-details-group", async () => {
      await page.getByRole("button", { name: "Collapse all groups" }).click();
      await page.waitForTimeout(2000);
      await page.locator('[aria-label="Category group: Food & Dining"]').first().click();
      await page.waitForTimeout(5000);
      await shootContent(guide, page, "budget-details-group");
    });
    await step("budget-details-month", async () => {
      await openCockpitMonth(page, month);
      await shootContent(guide, page, "budget-details-month");
    });
    const tracking = await openDemo("Tracking");
    try {
      const { shoot } = guide;
      await step("budget-tracking", async () => {
        await nav(tracking.page, "Budget Cockpit", 15000);
        await tracking.page.getByRole("button", { name: "Expand all groups" }).click();
        await tracking.page.waitForTimeout(3000);
        await shootContent(guide, tracking.page, "budget-tracking");
      });
      await step("budget-details-month-tracking", async () => {
        await openCockpitMonth(tracking.page, month);
        await shootContent(guide, tracking.page, "budget-details-month-tracking");
      });
    } finally {
      await tracking.browser.close();
    }
  }

  if (want("tools")) {
    await step("rule-diagnostics", async () => {
      await nav(page, "Rule Diagnostics", 12000);
      await guide.shootTo(page, "rule-diagnostics", page.locator("main article").nth(3), { right: await pageRight() });
    });
    await step("diagnostics-card", async () => {
      await guide.element(page.locator("main article").first(), "diagnostics-card");
    });
    await step("dialog-merge-rules", async () => {
      await page.getByRole("button", { name: /Merge 2 rules/ }).first().click();
      await page.waitForTimeout(6000);
      await dialogs.element(dialog(), "dialog-merge-rules");
      await closeDialog(page);
      await discardDraft();
    });
    await step("diagnostics-dismissed", async () => {
      await nav(page, "Rule Diagnostics", 12000);
      await page.getByRole("button", { name: /^Dismiss: / }).first().click();
      await page.waitForTimeout(2500);
      await page.getByText(/^Dismissed \d+$/).click();
      await page.waitForTimeout(2500);
      await guide.shootTo(page, "diagnostics-dismissed", page.locator("main article").last(), { right: await pageRight() });
      // Put it back: a dismissal is kept in Bench, and the next run should find
      // the same report.
      await page.getByRole("button", { name: /Restore/ }).first().click();
      await page.waitForTimeout(2000);
    });
    await step("dialog-generalise", async () => {
      // The demo has no rule matching whole bank strings, and must not gain one.
      // Importing a rules CSV stages without saving, diagnostics reads the
      // staged set, and Discard removes it again.
      const values = [
        "MARKET BOYS PTY LTD Melbourne VI AUS Card xx4534 Value Date: 12/03/2026",
        "MARKET BOYS PTY LTD Melbourne VI AUS Card xx9166 Value Date: 24/12/2026",
        "MARKET BOYS PTY LTD Sydney Value Date: 10/11/2026",
      ].join("|");
      const csv = [
        "rule_id,stage,conditions_op,row_type,field,op,value",
        `demo-generalise,pre,and,condition,imported_payee,oneOf,"${values}"`,
        "demo-generalise,pre,and,action,payee_name,set,Market Boys",
      ].join("\n");
      const file = join(await mkdtemp(join(tmpdir(), "bench-rules-")), "generalise-example.csv");
      await writeFile(file, csv, "utf8");
      await nav(page, "Rules", 7000);
      await page.locator('input[type="file"]').first().setInputFiles(file);
      await page.waitForTimeout(4000);
      await closeDialog(page);
      await nav(page, "Rule Diagnostics", 12000);
      await page.getByRole("button", { name: "Generalise this rule" }).first().click();
      await page.waitForTimeout(20000);
      await dialogs.element(dialog(), "dialog-generalise");
      await closeDialog(page);
      await discardDraft();
    });
    await step("actualql", async () => {
      await nav(page, "ActualQL Queries", 6000);
      await page.getByText("Latest 20 transactions", { exact: true }).click();
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.getByRole("table").first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(2500);
      await guide.shoot(page, "actualql", belowChrome(720, await pageRight()));
    });
    await step("budget-file-health", async () => {
      await nav(page, "Budget File Health", 15000);
      await guide.shootTo(page, "budget-file-health", page.getByText("Metadata", { exact: true }).first(), { pad: -16, right: await pageRight() });
    });
    await step("data-browser", async () => {
      await nav(page, "Data Browser", 15000);
      await guide.shoot(page, "data-browser", belowChrome(720, await pageRight()));
    });
  }

  if (want("recon")) {
    if (!isLocal()) throw new Error("the recon group creates a reconciliation session: run it against a local seed");
    // Named the way a bank names a download, since the name shows on screen.
    const folder = await mkdtemp(join(tmpdir(), "bench-statement-"));
    const scratch = join(folder, "statement.pdf");
    const month = await writeDemoStatement(browser, scratch);
    const pdf = join(folder, `example-bank-${month.toLowerCase().replace(" ", "-")}.pdf`);
    await rename(scratch, pdf);
    const tag = `${month.split(" ")[0]} close`;

    await nav(page, "Bank Reconciliation", 6000);
    await step("dialog-recon-new-session", async () => {
      await page.getByRole("button", { name: /New reconciliation/ }).first().click();
      await page.waitForTimeout(2000);
      await page.getByRole("option", { name: /Household Checking/ }).first().click();
      await dialog().getByPlaceholder(/close/).fill(tag);
      await page.waitForTimeout(600);
      await dialogs.element(dialog(), "dialog-recon-new-session");
    });
    await step("recon-pdf-detection", async () => {
      await dialog().getByRole("button", { name: "Start" }).click();
      await page.waitForTimeout(4000);
      await page.locator('input[type="file"]').first().setInputFiles(pdf);
      await page.getByText("Check detection").first().waitFor({ timeout: 60000 });
      await page.waitForTimeout(8000);
      await page.getByText("Check detection").first().click();
      await page.waitForTimeout(5000);
      await guide.element(dialog(), "recon-pdf-detection");
    });
    await step("recon-pdf-review", async () => {
      await page.getByText("Review transactions").first().click();
      await page.waitForTimeout(3000);
      const box = await dialog().boundingBox();
      await guide.shoot(page, "recon-pdf-review", { x: box.x, y: box.y, width: box.width, height: 520 });
      await page.getByRole("button", { name: /^Use \d+ transactions/ }).click();
      await page.waitForTimeout(8000);
    });
    await step("recon-import", async () => {
      await guide.shoot(page, "recon-import", belowChrome(560));
    });
    await step("bank-reconciliation", async () => {
      await page.getByRole("button", { name: /Match against Actual/ }).first().click();
      await page.waitForTimeout(15000);
      await guide.shoot(page, "bank-reconciliation", belowChrome(620));
    });
    await step("recon-matching", async () => {
      await page.getByRole("button", { name: "Re-run" }).first().click();
      await page.waitForTimeout(2000);
      const popover = page.locator("[data-radix-popper-content-wrapper], [role='dialog']").last();
      await guide.element(popover, "recon-matching");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    });
    await step("recon-transform", async () => {
      await page.getByRole("button", { name: "Transform" }).first().click();
      await page.waitForTimeout(2000);
      const box = await dialog().boundingBox();
      const end = await dialog().getByText(/rows? will change/).first().boundingBox();
      await guide.shoot(page, "recon-transform", { x: box.x, y: box.y, width: box.width, height: Math.ceil(end.y - box.y) - 8 });
      await closeDialog(page);
    });
    await step("recon-inspector", async () => {
      // A match that is good but not perfect: the reasons are the point.
      await page.getByText(/^8\d% High$/).first().click();
      await page.waitForTimeout(3000);
      await guide.shoot(page, "recon-inspector", { x: 760, y: 280, width: 1160, height: 800 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    });
    await step("recon-review", async () => {
      // The bank's fee is the row Actual is missing: create it, then review.
      const fee = page.getByText("MONTHLY ACCOUNT FEE").first();
      await fee.click();
      await page.waitForTimeout(2500);
      await page.getByRole("button", { name: /Create in Actual|Add to Actual|Create transaction/ }).first().click();
      await page.waitForTimeout(2500);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Review \d+ change/ }).first().click();
      await page.waitForTimeout(8000);
      await guide.shootTo(page, "recon-review", page.locator("main tbody tr").last());
    });
    await step("recon-sessions", async () => {
      await page.getByRole("button", { name: "All reconciliations" }).first().click();
      await page.waitForTimeout(4000);
      await guide.shootTo(page, "recon-sessions", page.locator("main tbody tr").last());
    });
  }

  if (want("ops")) {
    if (!isLocal()) throw new Error("the ops group creates backups and sync flows: run it against a local seed");

    await step("dialog-backup-rule", async () => {
      await nav(page, "Backups", 6000);
      // The page reopens on whichever tab was last shown.
      await page.getByRole("tab", { name: "Setup" }).click();
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "New backup rule" }).first().click();
      await page.waitForTimeout(3000);
      await dialogs.element(dialog(), "dialog-backup-rule");
      // Create it: a copy of the budget itself is what the Backups tab is for.
      await dialog().getByRole("button", { name: "Create rule" }).click();
      await page.waitForTimeout(4000);
    });
    await step("automations", async () => {
      // A server run of the seed's Bench-data backup, so the history has a real
      // entry and the Backups tab below has a verified copy of each kind.
      await nav(page, "Automations", 6000);
      await tab(page, "Automations", 3000);
      await page.getByRole("button", { name: "Run Monthly demo Bench backup now" }).click();
      await page.waitForTimeout(15000);
      await page.getByRole("button", { name: "Refresh" }).first().click();
      await page.waitForTimeout(3000);
      await guide.shootTo(page, "automations", page.getByRole("row").last(), { right: 1880, pad: 4 });
    });
    await step("backups", async () => {
      await nav(page, "Backups", 6000);
      await page.getByRole("tab", { name: "Setup" }).click();
      await page.waitForTimeout(1500);
      const rule = page.locator("tr", { hasText: "Nightly backup" }).first();
      await rule.getByRole("button", { name: /Back up now/ }).click();
      await page.waitForTimeout(30000);
      await page.getByRole("tab", { name: "Backups" }).click();
      await page.waitForTimeout(5000);
      await guide.shootTo(page, "backups", page.locator("main tbody tr").last(), { right: 1880 });
    });
    await step("dialog-new-bank-sync", async () => {
      await tab(page, "Automations", 3000);
      await page.getByRole("button", { name: /New automation/ }).first().click();
      await page.waitForTimeout(1500);
      await page.getByRole("menuitem", { name: /Bank sync/ }).click();
      await page.waitForTimeout(3000);
      await dialogs.element(dialog(), "dialog-new-bank-sync");
      await closeDialog(page);
    });
    await step("fx-rates", async () => {
      await nav(page, "Exchange Rates", 6000);
      // Real rates beside the seed's own, rather than a column of "not fetched".
      await page.getByRole("button", { name: /Fill range from Frankfurter/ }).click();
      await page.waitForTimeout(15000);
      const rows = page.locator("main tbody tr");
      const last = await rows.nth(Math.min(9, (await rows.count()) - 1)).boundingBox();
      await guide.shoot(page, "fx-rates", { x: 600, y: 96, width: 888, height: Math.ceil(last.y + last.height) - 96 + 12 });
    });
    await step("app-health", async () => {
      await page.getByRole("link", { name: "App Health" }).first().click();
      await page.waitForTimeout(8000);
      // From the database card down: the sign-in card would only describe how
      // this capture instance was started.
      const top = await page.getByText("App metadata database", { exact: true }).first().boundingBox();
      await admin.shoot(page, "app-health", { x: 600, y: Math.floor(top.y) - 32, width: 1080, height: 1080 - (Math.floor(top.y) - 32) - 8 });
    });
    await step("dialog-flow-editor", async () => {
      await connectSecond(page, "Tracking", "Envelope");
      await nav(page, "Cross Budget Sync", 6000);
      await page.getByRole("button", { name: "New sync flow" }).click();
      await page.waitForTimeout(3000);
      const d = dialog();
      await d.getByPlaceholder(/Joint card/).fill("Rewards card → Tracking");
      const pick = async (trigger, option) => {
        await d.getByText(trigger).first().click();
        await page.waitForTimeout(800);
        await page.getByRole("option", { name: option }).or(page.getByRole("menuitem", { name: option })).first().click();
        await page.waitForTimeout(1200);
      };
      await pick(/Source budget/, /Live Demo - Envelope/);
      await pick(/Select account/, /Everyday Rewards Card/);
      await pick(/Target budget/, /Live Demo - Tracking/);
      await pick(/Select account/, /Everyday Rewards Card/);
      // This month only, so the preview is a month of card spending rather
      // than the account's whole history.
      const now = new Date();
      const first = `${String(now.getMonth() + 1).padStart(2, "0")}/01/${now.getFullYear()}`;
      await d.getByRole("textbox", { name: "Start date" }).fill(first);
      await page.keyboard.press("Tab");
      await page.waitForTimeout(800);
      await dialogs.element(d, "dialog-flow-editor");
      await d.getByRole("button", { name: "Save flow" }).click();
      await page.waitForTimeout(5000);
    });
    await step("budget-file-sync", async () => {
      await page.getByRole("button", { name: "Sync preview" }).first().click();
      await page.waitForTimeout(30000);
      await guide.shoot(page, "budget-file-sync", belowChrome(760, 1880));
    });
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} shot(s) failed: ${failures.join(", ")}`);
  process.exitCode = 1;
}
