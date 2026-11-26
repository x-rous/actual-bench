/**
 * Shared helpers for the scripts that photograph the public demo:
 * capture-landing.mjs (the front page) and capture-guides.mjs (the guide pages).
 *
 * They drive the demo deployment directly rather than a private instance,
 * because the pages they photograph read the demo's own Bench data (loans,
 * cards, assets), which a private instance does not have. The demo host
 * accepts a headless browser that clicks "Envelope demo" like a visitor does.
 *
 * The window is 1920x1080, the size people actually run Actual Bench at. A
 * narrower window squeezes the app: account names wrap, month headers shorten
 * to "Feb ...", panels crowd each other. Captured at 2x on top of that, so the
 * images stay sharp on a high-density screen and when a reader zooms in. 3x and
 * 5x were tried: they look no better at any size a page shows them, and they made
 * one documentation page download over 7 MB of images. Crops are in CSS pixels
 * of the 1920x1080 window.
 *
 * The documentation site shows each image at its width divided by SCALE
 * (src/plugins/screenshot-size.mjs), so change both together.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

export const DEMO = (process.env.DEMO_UI_URL ?? "https://actual-bench-demo.vercel.app").replace(/\/+$/, "");
export const VIEWPORT = { width: 1920, height: 1080 };
export const SCALE = 2;

/** The app's sidebar and top bar, cropped off shots that are about one page. */
const CHROME = { left: 208, top: 48 };

/**
 * A crop below the app chrome, `height` CSS pixels tall. Pages with the
 * right-hand layers rail end their content at 1880.
 */
export const belowChrome = (height, right = VIEWPORT.width) => ({
  x: CHROME.left,
  y: CHROME.top,
  width: right - CHROME.left,
  height,
});

/** The groups named on the command line; none named means all of them. */
export function groupsWanted() {
  const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  return (group) => wanted.length === 0 || wanted.includes(group);
}

export async function shrinkLossless(path) {
  const buffer = await sharp(path).png({ compressionLevel: 9, effort: 10 }).toBuffer();
  await writeFile(path, buffer);
}

/**
 * Shots that create things in Bench (reconciliation sessions, sync flows,
 * backups) are only taken against a local seed: the public demo is shared, and
 * a visitor should not find a half-finished reconciliation someone else's
 * script left there.
 */
export const isLocal = () => Boolean(process.env.BENCH_URL);

/** Open one of the demo's budgets ("Envelope" or "Tracking") in a fresh 1920x1080 browser. */
export async function openDemo(budget = "Envelope") {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "light",
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    // A toast is a thing that was happening rather than a thing that is true.
    const style = document.createElement("style");
    // The development overlay button (a local seed runs `next dev`) is not part
    // of the product either.
    style.textContent = "nextjs-portal, #__next-dev-overlay, [data-sonner-toaster] { display: none !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  });
  const page = await context.newPage();
  if (LOCAL) {
    await connectLocal(page, budget);
  } else {
    await page.goto(DEMO, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByText(`${budget} demo`).click({ timeout: 60000 });
  }
  await page.waitForURL(/overview/, { timeout: 120000 });
  await page.waitForTimeout(8000);
  return { browser, page };
}

/**
 * A freshly generated seed, before it reaches the public demo: a local Actual
 * Server serving demo/seed-data and a local Bench whose database is a copy of
 * demo/seed-bench.sqlite (see docs/screenshots.md). Bench connects to it
 * Direct, with the seed's public password, and opens the budget asked for.
 */
const LOCAL = process.env.BENCH_URL
  ? {
      bench: process.env.BENCH_URL.replace(/\/+$/, ""),
      actual: (process.env.ACTUAL_URL ?? "http://localhost:5006").replace(/\/+$/, ""),
      password: process.env.SEED_PASSWORD ?? "demo-budget-public",
    }
  : null;

async function connectLocal(page, budget) {
  await page.goto(`${LOCAL.bench}/connect`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("tab", { name: /Direct Actual Server/ }).click({ timeout: 120000 });
  await page.locator("#baseUrl").fill(LOCAL.actual);
  await page.locator("#serverPassword").fill(LOCAL.password);
  await page.getByRole("button", { name: "Load budgets" }).click();
  await page.getByRole("button", { name: new RegExp(`Live Demo - ${budget}`) }).click({ timeout: 120000 });
  await page.getByRole("button", { name: "Connect", exact: true }).click();
}

/**
 * Connect a second demo budget beside the open one, through the app, so both
 * are live at once (Cross Budget Sync needs that). Ends with `active` budget
 * selected again, so later shots name the same budget in the top bar.
 */
export async function connectSecond(page, budget, active) {
  if (!LOCAL) throw new Error("connecting a second budget is only scripted for a local seed");
  await page.getByRole("button", { name: new RegExp(`Live Demo - ${active}`) }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("menuitem", { name: /Add connection/ }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Add a server" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("tab", { name: /Direct Actual Server/ }).click();
  await page.locator("#baseUrl").fill(LOCAL.actual);
  await page.locator("#serverPassword").fill(LOCAL.password);
  await page.getByRole("button", { name: "Load budgets" }).click();
  await page.getByRole("button", { name: new RegExp(`Live Demo - ${budget}`) }).click({ timeout: 120000 });
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.waitForURL(/overview/, { timeout: 120000 });
  await page.waitForTimeout(5000);
  await page.getByRole("button", { name: new RegExp(`Live Demo - ${budget}`) }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("menuitem", { name: new RegExp(`Live Demo - ${active}`) }).click();
  await page.waitForTimeout(5000);
}

/** Screenshot helpers that write into one folder. */
export async function shooter(outDir) {
  await mkdir(outDir, { recursive: true });

  /** Photograph the viewport, optionally cropped to a region in CSS pixels. */
  async function shoot(page, name, crop) {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path, animations: "disabled", ...(crop ? { clip: crop } : {}) });
    await shrinkLossless(path);
    console.log(`captured ${name}`);
    return path;
  }

  /** Photograph one element, such as an open dialog. */
  async function element(locator, name) {
    const path = join(outDir, `${name}.png`);
    await locator.screenshot({ path, animations: "disabled" });
    await shrinkLossless(path);
    console.log(`captured ${name}`);
    return path;
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
    const found = handle.asElement();
    await found.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    return element(found, name);
  }

  /**
   * Photograph the page below the app chrome, down to where `last` ends, so a
   * table of six rows is not a picture of a mostly empty pane.
   */
  async function shootTo(page, name, last, { right = VIEWPORT.width, pad = 12, max = 1032, left } = {}) {
    const box = await last.boundingBox();
    if (!box) throw new Error(`${name}: nothing to measure the crop against`);
    const height = Math.min(max, Math.ceil(box.y + box.height + pad) - 48);
    const crop = belowChrome(height, right);
    if (left !== undefined) {
      crop.width -= left - crop.x;
      crop.x = left;
    }
    return shoot(page, name, crop);
  }

  return { shoot, element, card, shootTo };
}

/** Scroll the app's main pane, which scrolls on its own rather than the window. */
export async function scrollMain(page, y) {
  await page.evaluate((top) => {
    const panes = [...document.querySelectorAll("*")].filter(
      (el) => el.scrollHeight > el.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(el).overflowY)
    );
    panes.sort((a, b) => b.scrollHeight - a.scrollHeight);
    if (panes[0]) panes[0].scrollTop = top;
  }, y);
  await page.waitForTimeout(1000);
}

/** Open a page from the sidebar and let it load. */
export async function nav(page, label, settle = 8000) {
  await page.getByRole("link", { name: label, exact: true }).first().click();
  await page.waitForTimeout(settle);
}

/** Select a tab (or any exact-text control) and let it load. */
export async function tab(page, label, settle = 7000) {
  await page.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(settle);
}

export async function closeDialog(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await page.locator('[role="dialog"]').count()) === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }
}

/**
 * Open the New cash plan dialog from either state of Cashflow Planning: the
 * empty state's "Create your first plan", or the plan menu's "New plan…" when a
 * plan is already open (someone may have left one in the shared demo).
 */
export async function openNewPlanDialog(page) {
  const first = page.getByRole("button", { name: /Create your first plan/ });
  const more = page.getByRole("button", { name: "More plan actions" });
  await first.or(more).first().waitFor({ timeout: 60000 });
  if (await first.isVisible()) {
    await first.click();
  } else {
    await more.click();
    await page.getByRole("menuitem", { name: "New plan…" }).click();
  }
  await page.waitForTimeout(3000);
}

/**
 * Cashflow Planning has no plan until someone makes one. Create one in the
 * shared demo, run `work` with it open, and delete it again whatever happens.
 * Only the plan this created is deleted: it is the one open after creating.
 */
export async function withTemporaryCashPlan(page, work) {
  await nav(page, "Cashflow Planning", 10000);
  await openNewPlanDialog(page);
  const dialog = page.locator('[role="dialog"]').first();
  await dialog.getByLabel("Name").fill("Five-year plan");
  await dialog.getByRole("button", { name: /^Create/ }).last().click();
  await page.waitForTimeout(15000);
  try {
    await work();
  } finally {
    // Leave the shared demo as it was found.
    await closeDialog(page);
    await page.getByRole("button", { name: "More plan actions" }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("menuitem", { name: /Delete/ }).click();
    await page.waitForTimeout(1200);
    await page.locator('[role="alertdialog"], [role="dialog"]').first().getByRole("button", { name: /Delete/ }).last().click();
    await page.waitForTimeout(4000);
    console.log("deleted the temporary cash plan");
  }
}

/**
 * The month the demo budget explains best: the medical deductible month, nine
 * months before the running one (demo/seed-scenario.cjs), when Health went far
 * over plan. Labelled the way the Budget Cockpit heads its columns ("Feb 2026").
 */
export function storyMonth(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth() - 9, 1);
  return `${date.toLocaleString("en-US", { month: "short" })} ${date.getFullYear()}`;
}

/** Open the Budget Cockpit with a month's column selected, so its month summary is beside the grid. */
export async function openCockpitMonth(page, month, { expand = false } = {}) {
  await nav(page, "Budget Cockpit", 15000);
  // Expanding clears the selection, so it comes first.
  if (expand) {
    await page.getByRole("button", { name: "Expand all groups" }).click();
    await page.waitForTimeout(3000);
  }
  const header = page.getByText(month, { exact: true }).first();
  if (!(await header.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Back 1 year" }).click();
    await page.waitForTimeout(4000);
  }
  await header.click();
  await page.waitForTimeout(3000);
}

/**
 * The month's two drill-throughs: Spending Analysis (the expense transactions
 * behind Spent) and Variance Drivers (balances in Envelope, plan in Tracking).
 */
export async function openMonthTransactions(page, month) {
  await page.getByRole("button", { name: `View expense transactions for ${month}` }).first().click();
  await page.waitForTimeout(6000);
}

export async function openMonthVariance(page, month, budget) {
  const button = budget === "Envelope"
    ? page.getByRole("button", { name: `View which envelopes drove the balance in ${month}` }).first()
    : page.getByRole("button", { name: "View variance drivers" }).last();
  await button.click();
  await page.waitForTimeout(8000);
}
