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
      try {
      await page.goto('http://127.0.0.1:17860/connect');
      await page.getByRole('button', { name: `${mode} demo` }).click();
      await page.waitForURL('**/overview');
      for (const [href, labels] of [
        ['/loans', ['Home Mortgage', 'Car Loan', 'Personal Loan', 'Investment Property Loan']],
        ['/credit-cards', ['Everyday Rewards Card', 'Everyday Installments Card']],
        ['/assets', ['Family Home', 'Family Car', 'Investment Property']],
        ['/reconciliation', ['Household Checking']],
      ]) {
        await page.locator(`aside a[href="${href}"]`).click();
        await page.waitForURL(`**${href}`);
        for (const label of labels) await page.getByText(label, { exact: false }).first().waitFor({ state: 'visible' });
        if (href === '/loans') {
          for (const loan of ['Home Mortgage', 'Car Loan', 'Personal Loan', 'Investment Property Loan']) {
            await page.getByRole('link', { name: loan, exact: true }).click();
            await page.getByRole('navigation', { name: 'Loan sections' }).getByRole('button', { name: 'Repayments', exact: true }).click();
            await page.getByRole('table', { name: 'Repayments' }).getByText('Recorded', { exact: true }).first().waitFor({ state: 'visible' });
            await page.locator('aside a[href="/loans"]').click();
            await page.getByRole('link', { name: loan, exact: true }).waitFor({ state: 'visible' });
          }
        }
        console.log(`browser: OK ${mode} ${href}`);
      }
      await page.locator('aside a[href="/fx-rates"]').click();
      await page.getByRole('button', { name: 'USD → AUD' }).waitFor({ state: 'visible' });
      await page.locator('aside a[href="/backups"]').click();
      await page.getByRole('tab', { name: 'Setup' }).click();
      await page.getByText('Demo backup folder', { exact: false }).first().waitFor({ state: 'visible' });
      await page.getByText('Monthly demo Bench backup', { exact: false }).first().waitFor({ state: 'visible' });
      await page.locator('aside a[href="/automations"]').click();
      await page.getByText('Monthly demo Bench backup', { exact: false }).first().waitFor({ state: 'visible' });
      await page.locator('aside a[href="/reconciliation"]').click();
      await page.getByText('Household Checking', { exact: false }).first().waitFor({ state: 'visible' });
      console.log(`browser: OK ${mode} FX and monthly backup setup`);
      const other = mode === 'Envelope' ? 'Tracking' : 'Envelope';
      await page.locator(`button[title^="Live Demo - ${mode} -"]`).click();
      await page.getByRole('menuitem', { name: new RegExp(`Live Demo - ${other}`) }).click();
      await page.locator(`button[title^="Live Demo - ${other} -"]`).waitFor({ state: 'visible' });
      await page.getByText('Household Checking', { exact: false }).first().waitFor({ state: 'visible' });
      console.log(`browser: OK ${mode} to ${other} budget switch`);
      } catch (error) {
        console.error(`browser failure at ${page.url()}: ${(await page.locator('body').innerText()).slice(0, 4000)}`);
        throw error;
      }
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
