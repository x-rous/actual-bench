#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- These Node scripts load CommonJS modules. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const mode of ['Envelope', 'Tracking']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      await page.goto('http://127.0.0.1:17860/connect');
      await page.getByRole('button', { name: `${mode} demo` }).click();
      await page.waitForURL('**/overview');
      for (const [href, labels] of [
        ['/loans', ['Home Mortgage', 'Car Loan']],
        ['/credit-cards', ['Everyday Rewards Card']],
        ['/assets', ['Family Home', 'Family Car']],
        ['/reconciliation', ['Household Checking']],
      ]) {
        await page.locator(`aside a[href="${href}"]`).click();
        await page.waitForURL(`**${href}`);
        for (const label of labels) await page.getByText(label, { exact: false }).first().waitFor({ state: 'visible' });
        console.log(`browser: OK ${mode} ${href}`);
      }
      const other = mode === 'Envelope' ? 'Tracking' : 'Envelope';
      await page.getByRole('button', { name: new RegExp(`Live Demo - ${mode}`) }).click();
      await page.getByRole('menuitem', { name: new RegExp(`Live Demo - ${other}`) }).click();
      await page.getByRole('button', { name: new RegExp(`Live Demo - ${other}`) }).waitFor({ state: 'visible' });
      await page.getByText('Household Checking', { exact: false }).first().waitFor({ state: 'visible' });
      console.log(`browser: OK ${mode} to ${other} budget switch`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
