/**
 * A bank statement PDF for the reconciliation screenshots, printed from the
 * demo seed itself.
 *
 * The PDF reader is the part of Bank Reconciliation people most want to see
 * before trusting it, and it needs a real PDF to show. Real statements cannot be
 * used: they are someone's finances. So this prints one for the demo household's
 * Household Checking account, from the transactions in demo/seed-data, for the
 * month two before the seed's latest (the month after it already has an applied
 * reconciliation in the seed). The bank is fictional and says so on the page.
 *
 * The rows are the account's real transactions, so they match. One monthly fee
 * is added that Actual does not have: it gives the workbench a row that is not
 * in Actual and the closing balance check a difference to explain.
 */

import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unzipSync } from "fflate";
import { tmpdir } from "node:os";

const SEED = join(import.meta.dirname, "..", "..", "demo", "seed-data", "user-files");
const ACCOUNT = "Household Checking";

/** Open the Envelope demo budget from the seed, read-only. */
function openSeedBudget() {
  for (const file of readdirSync(SEED).filter((name) => name.endsWith(".blob"))) {
    const entries = unzipSync(readFileSync(join(SEED, file)));
    const meta = JSON.parse(new TextDecoder().decode(entries["metadata.json"]));
    if (meta.budgetName !== "Live Demo - Envelope") continue;
    const path = join(mkdtempSync(join(tmpdir(), "demo-statement-")), "db.sqlite");
    writeFileSync(path, entries["db.sqlite"]);
    return new DatabaseSync(path, { readOnly: true });
  }
  throw new Error(`no Envelope demo budget in ${SEED}`);
}

/** Bank-style text for a row: the imported payee, or what the bank would print for a transfer. */
function bankText(row) {
  if (row.imported_payee) return row.imported_payee.toUpperCase();
  const notes = (row.notes ?? "").replace(/#\S+/g, "").trim();
  if (/brokerage/i.test(notes)) return "TRANSFER TO BROKERAGE";
  if (/fund/i.test(notes)) return "TRANSFER TO HIGH-YIELD SAVINGS";
  if (/mortgage/i.test(notes)) return "OAK STREET MORTGAGE EXTRA PAYMENT";
  if (/cash/i.test(notes)) return "ATM WITHDRAWAL MAIN ST";
  if (/installment/i.test(notes)) return "PAYMENT EVERYDAY INSTALLMENTS CARD";
  if (/credit card/i.test(notes)) return "PAYMENT EVERYDAY REWARDS CARD";
  return (row.payee_name || notes || "TRANSFER").toUpperCase();
}

const money = (cents) => (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const usDate = (d) => `${String(d).slice(4, 6)}/${String(d).slice(6, 8)}/${String(d).slice(0, 4)}`;

/**
 * Print the statement to `path` with `browser` (a Playwright Chromium).
 * Returns the month it covers, as "September 2026".
 */
export async function writeDemoStatement(browser, path) {
  const db = openSeedBudget();
  try {
    const account = db.prepare("SELECT id FROM accounts WHERE name = ? AND tombstone = 0").get(ACCOUNT);
    const latest = db.prepare("SELECT max(date) AS d FROM v_transactions WHERE account = ?").get(account.id).d;
    const year = Math.floor(latest / 10000);
    const month = Math.floor(latest / 100) % 100;
    const first = new Date(Date.UTC(year, month - 3, 1));
    const last = new Date(Date.UTC(year, month - 2, 0));
    const ymd = (date) => date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
    const [from, to] = [ymd(first), ymd(last)];

    const rows = db
      .prepare(
        `SELECT t.date, t.amount, t.imported_payee, p.name AS payee_name, t.notes
           FROM v_transactions t LEFT JOIN payees p ON p.id = t.payee
          WHERE t.account = ? AND t.date BETWEEN ? AND ? AND t.is_child = 0`
      )
      .all(account.id, from, to)
      .map((row) => ({ date: row.date, amount: row.amount, text: bankText(row) }));
    rows.push({ date: to, amount: -1200, text: "MONTHLY ACCOUNT FEE" });
    rows.sort((a, b) => a.date - b.date || b.amount - a.amount);

    const opening = db
      .prepare("SELECT coalesce(sum(amount), 0) AS s FROM v_transactions WHERE account = ? AND date < ? AND is_child = 0")
      .get(account.id, from).s;
    let balance = opening;
    const body = rows
      .map(({ date, amount, text }) => {
        balance += amount;
        return `<tr><td>${usDate(date)}</td><td>${text}</td><td class=n>${amount < 0 ? money(amount) : ""}</td><td class=n>${amount > 0 ? money(amount) : ""}</td><td class=n>${money(balance)}</td></tr>`;
      })
      .join("");
    const period = `${usDate(from)} - ${usDate(to)}`;

    const html = `<html><head><style>
      body{font-family:Helvetica,Arial,sans-serif;font-size:9.5pt;color:#1d2733;margin:0}
      .top{display:flex;justify-content:space-between;border-bottom:2px solid #1f4e79;padding-bottom:10px;margin-bottom:14px}
      h1{font-size:15pt;margin:0;color:#1f4e79}.muted{color:#5b6773}
      .sum{display:flex;gap:28px;margin:10px 0 16px}.sum b{display:block;font-size:11pt}
      table{width:100%;border-collapse:collapse}
      th{text-align:left;border-bottom:1px solid #1f4e79;padding:5px 4px;font-size:8.5pt;color:#1f4e79}
      td{padding:4px;border-bottom:1px solid #e3e7eb}.n{text-align:right;white-space:nowrap}
    </style></head><body>
      <div class=top>
        <div><h1>Example Community Bank</h1><div class=muted>Fictional bank for the Actual Bench documentation</div></div>
        <div style="text-align:right"><b>Everyday Checking</b><br><span class=muted>Account ending 4821</span><br>
          <span class=muted>Statement period ${period}</span><br><span class=muted>All amounts in USD</span></div>
      </div>
      <div class=sum><div><span class=muted>Opening balance</span><b>${money(opening)}</b></div>
        <div><span class=muted>Closing balance</span><b>${money(balance)}</b></div></div>
      <table><thead><tr><th>Date</th><th>Description</th><th class=n>Withdrawals</th><th class=n>Deposits</th><th class=n>Balance</th></tr></thead>
      <tbody>${body}</tbody></table>
    </body></html>`;

    const page = await browser.newPage();
    try {
      await page.setContent(html);
      await page.pdf({ path, format: "Letter", margin: { top: "40px", bottom: "40px", left: "44px", right: "44px" } });
    } finally {
      await page.close();
    }
    return first.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  } finally {
    db.close();
  }
}
