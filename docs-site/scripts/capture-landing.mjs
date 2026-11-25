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
 * page changes, this retakes them.
 *
 * Unlike capture-screenshots.mjs this drives the demo deployment directly. The
 * pages it photographs read the demo's own Bench data (loans, cards, assets),
 * which a private instance does not have. The demo host accepts a headless
 * browser that clicks "Envelope demo" like a visitor does.
 *
 * Cashflow Planning has no plan until someone makes one, so the "cashflow"
 * group creates a plan in the shared demo, photographs it and deletes it again.
 *
 * The window is 1920x1080, the size people actually run Actual Bench at. A
 * narrower window squeezes the app: account names wrap, month headers shorten
 * to "Feb ...", panels crowd each other - and a front page has to show the app
 * as it really looks. Captured at 3x on top of that, so the images stay sharp
 * when the page shows them on a high-density screen. Crops are in CSS pixels
 * of the 1920x1080 window.
 *
 * Requires Playwright's Chromium (`npx playwright install chromium-headless-shell`).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "src", "assets", "landing");
const DEMO = (process.env.DEMO_UI_URL ?? "https://actual-bench-demo.vercel.app").replace(/\/+$/, "");

const VIEWPORT = { width: 1920, height: 1080 };
const SCALE = 3;

/** The app's sidebar and top bar, cropped off shots that are about one page. */
const CHROME = { left: 208, top: 48 };

/**
 * A crop below the app chrome, `height` CSS pixels tall. Pages with the
 * right-hand layers rail end their content at 1880.
 */
const belowChrome = (height, right = VIEWPORT.width) => ({ x: CHROME.left, y: CHROME.top, width: right - CHROME.left, height });

const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const want = (group) => wanted.length === 0 || wanted.includes(group);

async function shrinkLossless(path) {
  const buffer = await sharp(path).png({ compressionLevel: 9, effort: 10 }).toBuffer();
  await writeFile(path, buffer);
}

/** Photograph the viewport, optionally cropped to a region given in CSS pixels. */
async function shoot(page, name, crop) {
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path, animations: "disabled", ...(crop ? { clip: crop } : {}) });
  await shrinkLossless(path);
  console.log(`captured ${name}`);
}

/** Photograph the bordered card that holds a heading. */
async function card(page, heading, name) {
  const handle = await page.getByText(heading).first().evaluateHandle((el) => {
    let node = el;
    while (node?.parentElement) {
      const style = getComputedStyle(node);
      if (style.borderTopWidth !== "0px" && parseFloat(style.borderTopLeftRadius) > 2 && node.getBoundingClientRect().width > 350) {
        return node;
      }
      node = node.parentElement;
    }
    return el;
  });
  const element = handle.asElement();
  await element.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const path = join(outDir, `${name}.png`);
  await element.screenshot({ path, animations: "disabled" });
  await shrinkLossless(path);
  console.log(`captured ${name}`);
}

/** Scroll the app's main pane, which scrolls on its own rather than the window. */
async function scrollMain(page, y) {
  await page.evaluate((top) => {
    const panes = [...document.querySelectorAll("*")].filter(
      (el) => el.scrollHeight > el.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(el).overflowY)
    );
    panes.sort((a, b) => b.scrollHeight - a.scrollHeight);
    if (panes[0]) panes[0].scrollTop = top;
  }, y);
  await page.waitForTimeout(1000);
}

async function nav(page, label, settle = 8000) {
  await page.getByRole("link", { name: label, exact: true }).first().click();
  await page.waitForTimeout(settle);
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  colorScheme: "light",
  acceptDownloads: true,
});
await context.addInitScript(() => {
  const style = document.createElement("style");
  style.textContent = "[data-sonner-toaster] { display: none !important; }";
  document.addEventListener("DOMContentLoaded", () => document.head.append(style));
});
const page = await context.newPage();

try {
  await page.goto(DEMO, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("Envelope demo").click({ timeout: 60000 });
  await page.waitForURL(/overview/, { timeout: 120000 });
  await page.waitForTimeout(8000);

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
    await nav(page, "Cashflow Planning", 10000);
    await page.getByRole("button", { name: /Create your first plan/ }).click();
    await page.waitForTimeout(3000);
    const dialog = page.locator('[role="dialog"]').first();
    await dialog.getByLabel("Name").fill("Five-year plan");
    await dialog.getByRole("button", { name: /^Create/ }).last().click();
    await page.waitForTimeout(15000);
    try {
      await shoot(page, "cashflow", belowChrome(732));
    } finally {
      // Leave the shared demo as it was found.
      await page.getByRole("button", { name: /More|actions/i }).first().click().catch(() => {});
      await page.waitForTimeout(1200);
      await page.getByRole("menuitem", { name: /Delete/ }).click();
      await page.waitForTimeout(1200);
      await page.locator('[role="alertdialog"], [role="dialog"]').first().getByRole("button", { name: /Delete/ }).last().click();
      await page.waitForTimeout(4000);
      console.log("deleted the temporary cash plan");
    }
  }
} finally {
  await browser.close();
}
