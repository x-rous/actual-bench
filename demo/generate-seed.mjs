// Headless seed-budget generator for the Actual Bench demo backend.
//
// Spins up a temporary local Actual sync server, creates equivalent Envelope
// and Tracking demo budgets with sample accounts and transactions, syncs both
// to the server, and leaves the synced data in demo/seed-data/ (which the Space
// Dockerfile bakes into the image). Prints both Sync IDs and the server password
// you'll need for deployment.
//
// Prerequisites (from the repo root):
//   npm i --no-save @actual-app/api@26.8.1 @actual-app/sync-server@26.8.1
// Run:
//   node demo/generate-seed.mjs
//
// Env overrides: SEED_PASSWORD (server password), SEED_PORT (default 5006).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rm, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

// @actual-app/api references `navigator` at module load; Node < 21 has no such
// global. Shim it before the package is required (here and in the server child).
globalThis.navigator ??= { platform: "", userAgent: "node" };

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const PASSWORD = process.env.SEED_PASSWORD || "demo-budget-public";
const PORT = Number(process.env.SEED_PORT || 5006);
const SERVER_URL = `http://localhost:${PORT}`;
const SEED_DATA_DIR = join(__dirname, "seed-data");
const DEMO_BUDGETS = [
  {
    name: "Live Demo",
    mode: "envelope",
    envName: "DEMO_BUDGET_SYNC_ID",
  },
  {
    name: "Live Demo - Tracking Mode",
    mode: "tracking",
    envName: "DEMO_TRACKING_BUDGET_SYNC_ID",
  },
];

// Use the same deterministic transaction amounts/payee choices in both files
// so changing budgets demonstrates mode semantics rather than different data.
function createSeededRandom(seed = 0x1a2b3c4d) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${SERVER_URL}/`);
      if (res.ok || res.status === 404) return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error("sync server did not come up in time");
}

async function main() {
  // Fresh seed dir.
  await rm(SEED_DATA_DIR, { recursive: true, force: true });
  await mkdir(SEED_DATA_DIR, { recursive: true });

  // Locate the sync server bin from the installed package.
  const serverBin = require.resolve(
    "@actual-app/sync-server/build/bin/actual-server.js"
  );

  // CJS preload so the server child also gets the `navigator` shim on Node < 21.
  const shimPath = join(await mkdtemp(join(tmpdir(), "actual-shim-")), "shim.cjs");
  await writeFile(
    shimPath,
    "globalThis.navigator ??= { platform: '', userAgent: 'node' };\n"
  );

  console.log("• starting temporary sync server...");
  const server = spawn(process.execPath, [serverBin], {
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${shimPath}`.trim(),
      ACTUAL_PORT: String(PORT),
      ACTUAL_DATA_DIR: SEED_DATA_DIR,
      ACTUAL_SERVER_FILES: join(SEED_DATA_DIR, "server-files"),
      ACTUAL_USER_FILES: join(SEED_DATA_DIR, "user-files"),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  try {
    await waitForServer();
    console.log("• sync server is up");

    // Bootstrap the server password (first-run).
    const boot = await fetch(`${SERVER_URL}/account/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    if (!boot.ok && boot.status !== 400) {
      throw new Error(`bootstrap failed: ${boot.status} ${await boot.text()}`);
    }

    const api = require("@actual-app/api");
    const apiDataDir = await mkdtemp(join(tmpdir(), "actual-seed-"));

    console.log("• connecting api client...");
    const apiLib = await api.init({
      dataDir: apiDataDir,
      serverURL: SERVER_URL,
      password: PASSWORD,
    });

    for (const demoBudget of DEMO_BUDGETS) {
      console.log(
        `• creating ${demoBudget.name} (${demoBudget.mode}) with a rich, realistic dataset...`
      );
      let counts;
      await api.runImport(demoBudget.name, async () => {
        // `budgetType` is a synced per-budget preference. Envelope is Actual's
        // default (no row); Tracking must be set before budget amounts are written
        // so `setBudgetAmount` targets reflect_budgets rather than zero_budgets.
        if (demoBudget.mode === "tracking") {
          await apiLib.send("preferences/save", {
            id: "budgetType",
            value: "tracking",
          });
        }

        // ── helpers ──────────────────────────────────────────────────────────
        const random = createSeededRandom();
        const rint = (min, max) => Math.floor(random() * (max - min + 1)) + min;
        const pick = (arr) => arr[Math.floor(random() * arr.length)];
        const pad = (n) => String(n).padStart(2, "0");
        const dstr = (y, mIdx, day) => `${y}-${pad(mIdx + 1)}-${pad(day)}`;

        // Last 4 months (3 prior + current), oldest first.
        const now = new Date();
        const months = [];
        for (let i = 3; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push({
            y: d.getFullYear(),
            mIdx: d.getMonth(),
            key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
          });
        }
        const current = months[months.length - 1];

        // ── accounts ─────────────────────────────────────────────────────────
        const checking = await api.createAccount({ name: "Checking", type: "checking" }, 480000);
        const savings = await api.createAccount({ name: "Savings", type: "savings" }, 1500000);
        const credit = await api.createAccount({ name: "Credit Card", type: "credit" }, -65000);
        const brokerage = await api.createAccount(
          { name: "Brokerage", type: "investment", offbudget: true },
          5000000
        );

        // ── category groups + categories ─────────────────────────────────────
        const mkGroup = (name, is_income = false) => api.createCategoryGroup({ name, is_income });
        // A fresh budget already has an "Income" group — reuse it rather than
        // creating a duplicate (the API rejects same-named groups).
        const existingGroups = await api.getCategoryGroups();
        const incomeGroup =
          existingGroups.find((g) => g.is_income)?.id ?? (await mkGroup("Income", true));
        const housing = await mkGroup("Housing");
        const food = await mkGroup("Food & Dining");
        const transport = await mkGroup("Transportation");
        const health = await mkGroup("Health & Fitness");
        const lifestyle = await mkGroup("Lifestyle");
        const savingsGroup = await mkGroup("Savings & Goals");

        const cat = {};
        const mkCat = async (key, name, group_id, opts = {}) => {
          cat[key] = await api.createCategory({ name, group_id, ...opts });
        };
        await mkCat("salary", "Salary", incomeGroup, { is_income: true });
        await mkCat("interest", "Interest", incomeGroup, { is_income: true });
        await mkCat("rent", "Rent", housing);
        await mkCat("electric", "Electricity", housing);
        await mkCat("internet", "Internet", housing);
        await mkCat("phone", "Phone", housing);
        await mkCat("groceries", "Groceries", food);
        await mkCat("restaurants", "Restaurants", food);
        await mkCat("coffee", "Coffee", food);
        await mkCat("gas", "Gas & Fuel", transport);
        await mkCat("gym", "Gym", health);
        await mkCat("pharmacy", "Pharmacy", health);
        await mkCat("subs", "Subscriptions", lifestyle);
        await mkCat("shopping", "Shopping", lifestyle);
        await mkCat("travel", "Travel", lifestyle);
        await mkCat("gifts", "Gifts", lifestyle);
        await mkCat("savecontrib", "Savings Contribution", savingsGroup);

        // Monthly budget targets (cents) for expense categories.
        const budgets = {
          rent: 150000, electric: 8000, internet: 6500, phone: 4500,
          groceries: 45000, restaurants: 18000, coffee: 4500, gas: 14000,
          gym: 3500, pharmacy: 3000, subs: 2700, shopping: 12000,
          travel: 10000, gifts: 5000, savecontrib: 50000,
        };

        // ── payees (incl. deliberate duplicates for the merge demo) ──────────
        const payee = {};
        const mkPayee = async (key, name) => { payee[key] = await api.createPayee({ name }); };
        await mkPayee("acme", "Acme Corp");
        await mkPayee("landlord", "Greenfield Property Mgmt");
        await mkPayee("power", "City Power & Light");
        await mkPayee("isp", "Fiberlink Internet");
        await mkPayee("phone", "TalkMobile");
        // Groceries — duplicate pair (Whole Foods / Whole Foods Market)
        await mkPayee("wf1", "Whole Foods");
        await mkPayee("wf2", "Whole Foods Market");
        await mkPayee("traderjoes", "Trader Joe's");
        await mkPayee("safeway", "Safeway");
        // Restaurants
        await mkPayee("chipotle", "Chipotle");
        await mkPayee("italian", "The Italian Place");
        await mkPayee("sushi", "Sushi Bar");
        // Coffee — duplicate pair (Starbucks / Starbucks Coffee)
        await mkPayee("sbux1", "Starbucks");
        await mkPayee("sbux2", "Starbucks Coffee");
        await mkPayee("bluebottle", "Blue Bottle");
        // Gas — duplicate pair (Shell / Shell Oil)
        await mkPayee("shell1", "Shell");
        await mkPayee("shell2", "Shell Oil");
        await mkPayee("chevron", "Chevron");
        // Subscriptions
        await mkPayee("netflix", "Netflix");
        await mkPayee("spotify", "Spotify");
        // Shopping — duplicate trio (Amazon / Amazon.com / AMZN Mktp)
        await mkPayee("amazon1", "Amazon");
        await mkPayee("amazon2", "Amazon.com");
        await mkPayee("amazon3", "AMZN Mktp");
        // Health
        await mkPayee("cvs", "CVS Pharmacy");
        await mkPayee("gym", "FitLife Gym");
        // Travel / misc
        await mkPayee("airline", "SkyHigh Airlines");
        await mkPayee("giftshop", "The Gift Shop");
        await mkPayee("savings", "Transfer to Savings");
        await mkPayee("bankint", "Savings Interest");
        await mkPayee("vanguard", "Vanguard");
        // Unused payee → drives the "rule with no matching transactions" diagnostic
        await mkPayee("oldsub", "Old Subscription (cancelled)");

        // ── tags ─────────────────────────────────────────────────────────────
        for (const t of ["reimbursable", "vacation", "review"]) {
          try { await api.createTag({ tag: t }); } catch { /* api version may differ */ }
        }

        // ── rules (categorize payees, rename imports, + diagnostics fodder) ──
        const setCat = (catId) => ({ op: "set", field: "category", value: catId });
        const payeeIs = (pId) => ({ field: "payee", op: "is", value: pId });
        const mkRule = (conditions, actions) =>
          api.createRule({ stage: null, conditionsOp: "and", conditions, actions });

        await mkRule([payeeIs(payee.wf1)], [setCat(cat.groceries)]);
        await mkRule([payeeIs(payee.traderjoes)], [setCat(cat.groceries)]);
        await mkRule([payeeIs(payee.shell1)], [setCat(cat.gas)]);
        await mkRule([payeeIs(payee.amazon1)], [setCat(cat.shopping)]);
        await mkRule([payeeIs(payee.netflix)], [setCat(cat.subs)]);
        await mkRule([payeeIs(payee.acme)], [setCat(cat.salary)]);
        // Payee normalization: imported "AMZN Mktp*" → canonical Amazon payee.
        await mkRule(
          [{ field: "imported_payee", op: "contains", value: "AMZN" }],
          [{ op: "set", field: "payee", value: payee.amazon1 }]
        );
        // Two IDENTICAL Starbucks→Coffee rules → "duplicate rule" diagnostic.
        await mkRule([payeeIs(payee.sbux1)], [setCat(cat.coffee)]);
        await mkRule([payeeIs(payee.sbux1)], [setCat(cat.coffee)]);
        // Rule referencing a payee with zero transactions → "no matches" diagnostic.
        await mkRule([payeeIs(payee.oldsub)], [setCat(cat.subs)]);

        // ── schedules (monthly recurring) ────────────────────────────────────
        const monthlyOn = (day) => ({
          frequency: "monthly",
          interval: 1,
          start: dstr(current.y, current.mIdx, day),
        });
        const mkSchedule = (name, account, payeeId, amount, day) =>
          api.createSchedule({
            name, account, payee: payeeId, amount, amountOp: "is",
            date: monthlyOn(day), posts_transaction: false,
          });
        await mkSchedule("Paycheck", checking, payee.acme, 420000, 1);
        await mkSchedule("Rent", checking, payee.landlord, -150000, 1);
        await mkSchedule("Internet", checking, payee.isp, -6500, 7);
        await mkSchedule("Phone", checking, payee.phone, -4500, 10);
        await mkSchedule("Gym Membership", credit, payee.gym, -3500, 3);

        // ── transactions across all months ──────────────────────────────────
        let txnCount = 0;
        const push = async (account, list) => {
          if (list.length) { await api.addTransactions(account, list); txnCount += list.length; }
        };
        const groceryPayees = [payee.wf1, payee.wf2, payee.traderjoes, payee.safeway];
        const restaurantPayees = [payee.chipotle, payee.italian, payee.sushi];
        const coffeePayees = [payee.sbux1, payee.sbux2, payee.bluebottle];
        const gasPayees = [payee.shell1, payee.shell2, payee.chevron];

        for (let mi = 0; mi < months.length; mi++) {
          const m = months[mi];
          const D = (day) => dstr(m.y, m.mIdx, day);

          // Checking: income + fixed bills
          await push(checking, [
            { date: D(1), payee: payee.acme, amount: 420000, category: cat.salary, cleared: true, notes: "Monthly salary" },
            { date: D(1), payee: payee.landlord, amount: -150000, category: cat.rent, cleared: true },
            { date: D(5), payee: payee.power, amount: -rint(6000, 9500), category: cat.electric, cleared: true },
            { date: D(7), payee: payee.isp, amount: -6500, category: cat.internet, cleared: true },
            { date: D(10), payee: payee.phone, amount: -4500, category: cat.phone, cleared: true },
            { date: D(16), payee: payee.savings, amount: -50000, category: cat.savecontrib, cleared: true, notes: "Auto-save" },
          ]);

          // Savings: matching deposit + interest
          await push(savings, [
            { date: D(16), payee: payee.savings, amount: 50000, cleared: true },
            { date: D(15), payee: payee.bankint, amount: rint(200, 700), category: cat.interest, cleared: true },
          ]);

          // Brokerage (off-budget): monthly dividend
          await push(brokerage, [
            { date: D(20), payee: payee.vanguard, amount: rint(1200, 3200), cleared: true, notes: "Dividend" },
          ]);

          // Credit card: day-to-day spending
          const credits = [];
          // Groceries weekly
          for (const day of [3, 11, 18, 25]) {
            credits.push({ date: D(day), payee: pick(groceryPayees), amount: -rint(3500, 12500), category: cat.groceries, cleared: true });
          }
          // Restaurants
          for (const day of [6, 13, 21]) {
            if (random() < 0.85) {
              const note = day === 13 ? "Dinner with friends #reimbursable" : undefined;
              credits.push({ date: D(day), payee: pick(restaurantPayees), amount: -rint(2200, 7800), category: cat.restaurants, cleared: true, ...(note ? { notes: note } : {}) });
            }
          }
          // Coffee
          for (const day of [2, 9, 12, 19, 23, 27]) {
            credits.push({ date: D(day), payee: pick(coffeePayees), amount: -rint(380, 760), category: cat.coffee, cleared: true });
          }
          // Gas
          for (const day of [4, 17, 28]) {
            credits.push({ date: D(day), payee: pick(gasPayees), amount: -rint(3200, 6200), category: cat.gas, cleared: true });
          }
          // Subscriptions
          credits.push({ date: D(8), payee: payee.netflix, amount: -1599, category: cat.subs, cleared: true });
          credits.push({ date: D(8), payee: payee.spotify, amount: -1099, category: cat.subs, cleared: true });
          // Gym
          credits.push({ date: D(3), payee: payee.gym, amount: -3500, category: cat.gym, cleared: true });
          // Shopping — one canonical Amazon, one imported "AMZN Mktp" left UNCATEGORIZED
          credits.push({ date: D(14), payee: payee.amazon1, amount: -rint(1500, 9000), category: cat.shopping, cleared: true });
          credits.push({ date: D(22), payee: payee.amazon3, imported_payee: "AMZN Mktp*US2", amount: -rint(1200, 6000), cleared: true });
          // Pharmacy ~ every other month
          if (mi % 2 === 0) {
            credits.push({ date: D(21), payee: payee.cvs, amount: -rint(1200, 4200), category: cat.pharmacy, cleared: true });
          }
          // Occasional travel (one month) + gift (another) — with tags
          if (mi === 1) {
            credits.push({ date: D(24), payee: payee.airline, amount: -rint(18000, 46000), category: cat.travel, cleared: true, notes: "Weekend trip #vacation" });
          }
          if (mi === 2) {
            credits.push({ date: D(9), payee: payee.giftshop, amount: -rint(3000, 9000), category: cat.gifts, cleared: true, notes: "Birthday gift" });
          }
          // One uncategorized "needs review" charge per month
          credits.push({ date: D(26), payee: pick(restaurantPayees), amount: -rint(1500, 4500), cleared: false, notes: "#review uncategorized" });

          await push(credit, credits);
        }

        // Budget every expense category for every month — batched so the budget
        // spreadsheet recalculates once, not per write (much faster).
        await api.batchBudgetUpdates(async () => {
          for (const m of months) {
            for (const [key, value] of Object.entries(budgets)) {
              await api.setBudgetAmount(m.key, cat[key], value);
            }
            if (demoBudget.mode === "tracking") {
              // Tracking budgets plan income as well as expenses. Keep salary on
              // plan and use a modest expected interest amount so income variance
              // is visible without dominating the sample data.
              await api.setBudgetAmount(m.key, cat.salary, 420000);
              await api.setBudgetAmount(m.key, cat.interest, 450);
            }
          }
        });

        counts = {
          accounts: 4,
          categoryGroups: 7,
          categories: Object.keys(cat).length,
          payees: Object.keys(payee).length,
          rules: 11,
          schedules: 5,
          months: months.length,
          transactions: txnCount,
        };
      });

      if (!counts) {
        throw new Error(`dataset counts were not captured for ${demoBudget.name}`);
      }

      const preferences = await api.getPreferences();
      const actualMode =
        preferences.budgetType === "tracking" ? "tracking" : "envelope";
      if (actualMode !== demoBudget.mode) {
        throw new Error(
          `${demoBudget.name} mode mismatch: expected ${demoBudget.mode}, got ${actualMode}`
        );
      }
      console.log("• dataset:", JSON.stringify({ ...counts, mode: actualMode }));

      console.log(`• syncing ${demoBudget.name} to server...`);
      await api.sync();
    }
    await api.shutdown();

    // Look up the Sync IDs (groupIds) the server assigned to both budgets.
    const login = await fetch(`${SERVER_URL}/account/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const token = (await login.json())?.data?.token;
    const list = await fetch(`${SERVER_URL}/sync/list-user-files`, {
      headers: { "X-ACTUAL-TOKEN": token ?? "" },
    });
    const files = (await list.json())?.data ?? [];
    const activeFiles = files.filter((file) => !file.deleted);
    if (activeFiles.length !== DEMO_BUDGETS.length) {
      throw new Error(
        `expected ${DEMO_BUDGETS.length} active demo budgets, found ${activeFiles.length}`
      );
    }

    const generatedBudgets = DEMO_BUDGETS.map((demoBudget) => {
      const file = activeFiles.find((candidate) => candidate.name === demoBudget.name);
      if (!file?.groupId) {
        throw new Error(`missing synced budget: ${demoBudget.name}`);
      }
      return { ...demoBudget, groupId: file.groupId };
    });

    console.log("\n────────────────────────────────────────────────────");
    console.log("✅ Seed budgets generated → demo/seed-data/");
    console.log("");
    for (const budget of generatedBudgets) {
      console.log(`  ${budget.envName} :`, budget.groupId);
    }
    console.log("  ACTUAL_SERVER_PASSWORD:", PASSWORD);
    console.log("");
    console.log("Set ACTUAL_SERVER_PASSWORD as a Space secret, and");
    console.log("both DEMO_*_BUDGET_SYNC_ID values as Vercel env vars.");
    console.log("────────────────────────────────────────────────────");
  } finally {
    server.kill("SIGTERM");
    await sleep(500);
  }
}

main().catch((err) => {
  console.error("seed generation failed:", err);
  process.exit(1);
});
