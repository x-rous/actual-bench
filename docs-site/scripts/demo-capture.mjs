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
 * to "Feb ...", panels crowd each other. Captured at 3x on top of that, so the
 * images stay sharp on a high-density screen. Crops are in CSS pixels of the
 * 1920x1080 window.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

export const DEMO = (process.env.DEMO_UI_URL ?? "https://actual-bench-demo.vercel.app").replace(/\/+$/, "");
export const VIEWPORT = { width: 1920, height: 1080 };
export const SCALE = 3;

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

/** Open the demo's Envelope budget in a fresh 1920x1080 browser. */
export async function openDemo() {
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
    style.textContent = "[data-sonner-toaster] { display: none !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  });
  const page = await context.newPage();
  await page.goto(DEMO, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("Envelope demo").click({ timeout: 60000 });
  await page.waitForURL(/overview/, { timeout: 120000 });
  await page.waitForTimeout(8000);
  return { browser, page };
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

  return { shoot, element, card };
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
 * Cashflow Planning has no plan until someone makes one. Create one in the
 * shared demo, run `work` with it open, and delete it again whatever happens.
 */
export async function withTemporaryCashPlan(page, work) {
  await nav(page, "Cashflow Planning", 10000);
  await page.getByRole("button", { name: /Create your first plan/ }).click();
  await page.waitForTimeout(3000);
  const dialog = page.locator('[role="dialog"]').first();
  await dialog.getByLabel("Name").fill("Five-year plan");
  await dialog.getByRole("button", { name: /^Create/ }).last().click();
  await page.waitForTimeout(15000);
  try {
    await work();
  } finally {
    // Leave the shared demo as it was found.
    await closeDialog(page);
    await page.getByRole("button", { name: /More|actions/i }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.getByRole("menuitem", { name: /Delete/ }).click();
    await page.waitForTimeout(1200);
    await page.locator('[role="alertdialog"], [role="dialog"]').first().getByRole("button", { name: /Delete/ }).last().click();
    await page.waitForTimeout(4000);
    console.log("deleted the temporary cash plan");
  }
}
