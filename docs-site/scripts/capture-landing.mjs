#!/usr/bin/env node
/**
 * Capture the front page's images from the public demo.
 *
 *   node docs-site/scripts/capture-landing.mjs            # everything
 *   node docs-site/scripts/capture-landing.mjs loans cards  # named groups
 *
 * The front page shows the product to someone who has never opened it, so its
 * images are the real app on the demo household - never a real budget - and
 * like the documentation screenshots they are generated, not collected: when a
 * page changes, this retakes them. How and why the demo is photographed is in
 * demo-capture.mjs.
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
  groupsWanted,
  nav,
  openDemo,
  scrollMain,
  shooter,
  shrinkLossless,
  withTemporaryCashPlan,
} from "./demo-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "src", "assets", "landing");
const want = groupsWanted();
const { shoot, card } = await shooter(outDir);
const { browser, page } = await openDemo();

try {
  if (want("insights")) {
    await nav(page, "Financial Insights", 0);
    await page.getByText("Net worth", { exact: true }).first().waitFor({ timeout: 300000 });
    await page.waitForTimeout(8000);
    // The hero: the page itself, without the sidebar and top bar around it.
    await shoot(page, "insights-summary", belowChrome(1032));
    await card(page, "Your cash buffer", "insights-cash-buffer");
    await card(page, "What changed your net worth", "insights-waterfall");
    await card(page, "Where your money came from and went", "insights-money-flow");

    await page.getByText("Spending", { exact: true }).first().click();
    await page.waitForTimeout(9000);
    await scrollMain(page, 0);
    await shoot(page, "insights-spending", belowChrome(667));

    // Progress cards are images the app renders for sharing; save the app's own
    // files rather than photographing them.
    await page.getByText("Progress", { exact: true }).first().click();
    await page.waitForTimeout(9000);
    const cards = {
      "net-worth": "progress-net-worth",
      "debt-payoff": "progress-debt-payoff",
      "savings-rate": "progress-savings-rate",
      "savings-consistency": "progress-savings-consistency",
      "cash-buffer.png": "progress-cash-buffer",
      "asset-composition": "progress-asset-composition",
    };
    // The debt card shows the loans: a card paid in full each month draws a
    // zigzag, while the loans fall steadily toward their debt-free date.
    await page.getByRole("button", { name: "Loans", exact: true }).first().click();
    await page.waitForTimeout(1500);
    const buttons = page.getByRole("button", { name: "Download PNG" });
    for (let i = 0; i < (await buttons.count()); i++) {
      const [download] = await Promise.all([page.waitForEvent("download"), buttons.nth(i).click()]);
      const file = download.suggestedFilename();
      const key = Object.keys(cards).find((k) => file.includes(k));
      if (key) {
        const path = join(outDir, `${cards[key]}.png`);
        await download.saveAs(path);
        await shrinkLossless(path);
        console.log(`saved ${cards[key]} (${file})`);
      }
      await page.waitForTimeout(800);
    }
  }

  if (want("loans")) {
    await nav(page, "Loans", 7000);
    await page.getByText("Home Mortgage", { exact: true }).first().click();
    await page.waitForTimeout(9000);
    await page.getByText("Terms & Schedule", { exact: true }).first().click();
    await page.waitForTimeout(6000);
    await shoot(page, "loan-terms", belowChrome(712));
  }

  if (want("cards")) {
    await nav(page, "Credit Cards");
    await page.getByText("Everyday Rewards Card", { exact: true }).first().click();
    await page.waitForTimeout(9000);
    await shoot(page, "card-overview", belowChrome(920));
  }

  if (want("assets")) {
    await nav(page, "Assets");
    await page.getByText("Family Home", { exact: true }).first().click();
    await page.waitForTimeout(9000);
    await shoot(page, "asset-home", belowChrome(517));
  }

  if (want("accounts")) {
    await nav(page, "Accounts");
    await shoot(page, "accounts", belowChrome(670, 1880));
  }

  if (want("cockpit")) {
    await nav(page, "Budget Cockpit", 12000);
    await page.getByRole("button", { name: /Expand/ }).first().click();
    await page.waitForTimeout(3000);
    await shoot(page, "cockpit", belowChrome(712));
  }

  // The workbench close-ups: one strip per group, the part of the page that
  // shows what the tool does.
  if (want("bench")) {
    await nav(page, "Rule Diagnostics", 12000);
    await shoot(page, "bench-rule-diagnostics", belowChrome(434, 1880));

    await nav(page, "Payee Cleanup", 15000);
    await shoot(page, "bench-payee-cleanup", belowChrome(342, 1880));

    await nav(page, "Backups", 8000);
    await page.getByRole("tab", { name: "Backups" }).click();
    await page.waitForTimeout(4000);
    await shoot(page, "bench-backups", belowChrome(237, 1880));

    await nav(page, "ActualQL Queries", 6000);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.waitForTimeout(5000);
    await shoot(page, "bench-actualql", belowChrome(692, 1880));
  }

  if (want("cashflow")) {
    await withTemporaryCashPlan(page, () => shoot(page, "cashflow", belowChrome(732)));
  }
} finally {
  await browser.close();
}
