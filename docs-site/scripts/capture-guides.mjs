#!/usr/bin/env node
/**
 * Capture the guide-page screenshots that need the demo's own Bench data.
 *
 *   node docs-site/scripts/capture-guides.mjs              # everything
 *   node docs-site/scripts/capture-guides.mjs loans cards  # named groups
 *
 * Groups: insights, budget, loans, cards, assets, cashflow, payee-cleanup.
 *
 * capture-pages.mjs photographs the rest of the app. These pages read what
 * Bench itself stores about the demo household (loan terms, card statements,
 * registered assets), so they need the demo's Bench data: the public demo, or a
 * local seed (BENCH_URL, see docs/screenshots.md). How and why is in
 * demo-capture.mjs.
 *
 * Each shot is cropped to the part of the page that shows the function: the
 * sidebar and top bar stay out, and a dialog is photographed on its own.
 *
 * The "cashflow" group creates a plan in the shared demo, photographs it and
 * deletes it again.
 *
 * Requires Playwright's Chromium (`npx playwright install chromium-headless-shell`).
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  belowChrome,
  closeDialog,
  groupsWanted,
  nav,
  openCockpitMonth,
  openDemo,
  openMonthTransactions,
  openMonthVariance,
  openNewPlanDialog,
  scrollMain,
  shooter,
  storyMonth,
  tab,
  withTemporaryCashPlan,
} from "./demo-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "src", "assets", "screenshots", "user-guide");
const want = groupsWanted();
const { shoot, element } = await shooter(outDir);
const { browser, page } = await openDemo();
const dialog = () => page.locator('[role="dialog"]').first();
const failures = [];

/** One shot; a failure is reported and the run carries on with the next. */
async function step(name, work) {
  try {
    await work();
  } catch (error) {
    console.log(`FAILED   ${name}: ${String(error?.message ?? error).split("\n")[0]}`);
    failures.push(name);
    await closeDialog(page);
  }
}

async function openRow(label) {
  await page.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(9000);
}

try {
  if (want("insights")) {
    await nav(page, "Financial Insights", 0);
    await page.getByText("Net worth", { exact: true }).first().waitFor({ timeout: 300000 });
    await page.waitForTimeout(8000);
    await step("fi-summary", () => shoot(page, "fi-summary", belowChrome(667)));
    await step("fi-simulate", async () => {
      await page.getByRole("button", { name: "Simulate" }).click();
      await page.waitForTimeout(3000);
      await element(dialog(), "fi-simulate");
      await closeDialog(page);
    });
    await step("fi-drilldown", async () => {
      // The money spent under Money kept, whatever the demo's figure is today.
      await page.getByRole("button", { name: /^Money spent .*Show the transactions$/ }).first().click();
      await page.waitForTimeout(4000);
      await element(dialog(), "fi-drilldown");
      await closeDialog(page);
    });
    const tabs = [
      ["Money in & out", "fi-money-in-out", 1020],
      ["Income", "fi-income", 960],
      ["Spending", "fi-spending", 1032],
      ["My budget", "fi-my-budget", 842],
      ["Investments", "fi-investments", 624],
      ["Property & assets", "fi-property", 978],
      ["Loans & cards", "fi-loans-cards", 680],
      ["Statements", "fi-statements", 868],
    ];
    for (const [label, name, height] of tabs) {
      await step(name, async () => {
        await tab(page, label, 8000);
        await scrollMain(page, 0);
        await shoot(page, name, belowChrome(height));
      });
    }
  }

  if (want("budget")) {
    // Budget Cockpit's drill-throughs, on the month with most to explain: the
    // Envelope budget's Variance Drivers reads balances, the Tracking budget's
    // reads the plan, and Spending Analysis is shown from Tracking.
    const month = storyMonth();
    await step("budget-variance-envelope", async () => {
      await openCockpitMonth(page, month);
      await openMonthVariance(page, month, "Envelope");
      await element(dialog(), "budget-variance-envelope");
      await closeDialog(page);
    });
    const tracking = await openDemo("Tracking");
    const trackingDialog = () => tracking.page.locator('[role="dialog"]').first();
    try {
      await step("budget-spending-analysis", async () => {
        await openCockpitMonth(tracking.page, month);
        await openMonthTransactions(tracking.page, month);
        await element(trackingDialog(), "budget-spending-analysis");
        await closeDialog(tracking.page);
      });
      await step("budget-variance-tracking", async () => {
        await openMonthVariance(tracking.page, month, "Tracking");
        await element(trackingDialog(), "budget-variance-tracking");
      });
    } finally {
      await tracking.browser.close();
    }
  }

  if (want("loans")) {
    await nav(page, "Loans", 7000);
    await step("loans-overview", () => shoot(page, "loans-overview", belowChrome(612)));
    await openRow("Home Mortgage");
    const tabs = [
      ["Terms & Schedule", "loan-terms", 1032],
      ["Link to Actual", "loan-link", 1032],
      ["Repayments", "loan-repayments", 712],
      ["Loan Ledger", "loan-ledger", 710],
      ["Linked Assets", "loan-linked-assets", 290],
    ];
    for (const [label, name, height] of tabs) {
      await step(name, async () => {
        await tab(page, label, 6000);
        await shoot(page, name, belowChrome(height));
      });
    }
  }

  if (want("cards")) {
    await nav(page, "Credit Cards");
    await step("cards-all", () => shoot(page, "cards-all", belowChrome(340)));
    await step("cards-payoff-plan", async () => {
      await page.getByRole("button", { name: "Payoff plan" }).first().click();
      await page.waitForTimeout(3000);
      await shoot(page, "cards-payoff-plan", belowChrome(570));
      await page.getByRole("button", { name: "Payoff plan" }).first().click();
      await page.waitForTimeout(1000);
    });
    await openRow("Everyday Rewards Card");
    await step("card-overview", () => shoot(page, "card-overview", belowChrome(920)));
    await step("card-statements", async () => {
      await tab(page, "Statements", 6000);
      await shoot(page, "card-statements", belowChrome(335));
    });
    await step("card-statement-review", async () => {
      // Review opens as a page of its own; its back button returns to Statements.
      await page.getByRole("button", { name: "Review", exact: true }).nth(1).click();
      await page.waitForTimeout(6000);
      await shoot(page, "card-statement-review", belowChrome(560));
      await page.getByRole("button", { name: "Statements" }).first().click();
      await page.waitForTimeout(4000);
    });
    await step("card-payments", async () => {
      await tab(page, "Payments", 6000);
      await shoot(page, "card-payments", belowChrome(282));
    });
    await step("card-activity", async () => {
      await tab(page, "Activity", 6000);
      await shoot(page, "card-activity", belowChrome(560));
    });
    await nav(page, "Credit Cards");
    await openRow("Everyday Installments Card");
    await step("card-instalment-plans", async () => {
      await tab(page, "Instalment Plans", 6000);
      await shoot(page, "card-instalment-plans", belowChrome(220));
    });
  }

  if (want("assets")) {
    await nav(page, "Assets");
    await step("assets-registry", () => shoot(page, "assets-registry", belowChrome(395)));
    await openRow("Investment Property");
    await step("asset-overview", () => shoot(page, "asset-overview", belowChrome(1032)));
    await step("asset-income-expenses", async () => {
      await tab(page, "Income & Expenses", 6000);
      await shoot(page, "asset-income-expenses", belowChrome(720));
    });
    await nav(page, "Assets");
    await openRow("Family Home");
    await step("asset-ledger", async () => {
      await tab(page, "Asset Ledger", 6000);
      await shoot(page, "asset-ledger", belowChrome(560));
    });
    await step("asset-linked-loans", async () => {
      await tab(page, "Linked Loans", 6000);
      await shoot(page, "asset-linked-loans", belowChrome(335));
    });
  }

  if (want("cashflow")) {
    await step("cashflow-new-plan", async () => {
      await nav(page, "Cashflow Planning", 10000);
      await openNewPlanDialog(page);
      // The create button reads the loan schedules first; wait until it is ready.
      await dialog().getByRole("button", { name: /^Create/ }).last().waitFor({ timeout: 120000 });
      await page.waitForTimeout(1500);
      await element(dialog(), "cashflow-new-plan");
      await closeDialog(page);
    });
    await step("cashflow-plan", () =>
      withTemporaryCashPlan(page, async () => {
        await shoot(page, "cashflow-plan", belowChrome(1032));
        await page.getByRole("button", { name: "Plan settings" }).first().click();
        await page.waitForTimeout(3000);
        await element(dialog(), "cashflow-settings");
        await closeDialog(page);
      })
    );
  }

  if (want("payee-cleanup")) {
    await nav(page, "Payee Cleanup", 15000);
    await step("payee-cleanup", () => shoot(page, "payee-cleanup", belowChrome(342, 1880)));
    await step("payee-cleanup-reasoning", async () => {
      await page.getByRole("button", { name: /Reasoning/ }).first().click();
      await page.waitForTimeout(2000);
      await shoot(page, "payee-cleanup-reasoning", belowChrome(430, 1880));
    });
    await step("payee-cleanup-needs-rule", async () => {
      await page.getByRole("button", { name: /Payees needing rules/ }).click();
      await page.waitForTimeout(5000);
      await shoot(page, "payee-cleanup-needs-rule", belowChrome(560, 1880));
    });
    await step("payee-cleanup-unused", async () => {
      await page.getByRole("button", { name: /Unused payees/ }).click();
      await page.waitForTimeout(5000);
      await shoot(page, "payee-cleanup-unused", belowChrome(505, 1880));
    });
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} shot(s) failed: ${failures.join(", ")}`);
  process.exitCode = 1;
}
