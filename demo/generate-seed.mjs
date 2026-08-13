// Headless seed-budget generator for the Actual Bench demo backend.
//
// Creates equivalent Envelope and Tracking budgets containing twelve complete
// months plus the current partial month of a fictional household's finances.
// The generated Actual Server data directory is baked into the public demo
// image. Every random choice is deterministic so the two files differ only in
// budgeting semantics, not source data.
//
// Prerequisites (from the repository root):
//   npm i --no-save @actual-app/api@26.8.1 @actual-app/sync-server@26.8.1
// Run:
//   node demo/generate-seed.mjs
//
// Env overrides: SEED_PASSWORD (server password), SEED_PORT (default 5006).

import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rm, mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

globalThis.navigator ??= { platform: "", userAgent: "node" };

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const {
  CATEGORY_GROUPS,
  DEMO_BUDGETS,
  TAGS,
  budgetPlanForMonth,
  buildMonths,
  pad,
  scenarioForMonth,
} = require("./seed-scenario.cjs");

const PASSWORD = process.env.SEED_PASSWORD || "demo-budget-public";
const PORT = Number(process.env.SEED_PORT || 5006);
const SERVER_URL = `http://localhost:${PORT}`;
const SEED_DATA_DIR = join(__dirname, "seed-data");

function createSeededRandom(seed = 0x1a2b3c4d) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${SERVER_URL}/`);
      if (response.ok || response.status === 404) return;
    } catch {
      // The server is still starting.
    }
    await sleep(1000);
  }
  throw new Error("sync server did not come up in time");
}

function getRows(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.data) ? result.data : [];
}

async function queryRows(api, table, select, options) {
  let query = api.q(table);
  if (options) query = query.options(options);
  return getRows(await api.aqlQuery(query.select(select)));
}

function stableRuleSignature(rule) {
  const sortParts = (parts) =>
    [...parts]
      .map((part) => JSON.stringify(part))
      .sort()
      .join("|");
  return [
    rule.stage ?? "",
    rule.conditionsOp ?? "and",
    sortParts(rule.conditions ?? []),
    sortParts(rule.actions ?? []),
  ].join("::");
}

function validateRuleShowcase(rules) {
  const signatures = new Map();
  for (const rule of rules) {
    if (rule.actions?.some((action) => action.op === "link-schedule")) continue;
    const signature = stableRuleSignature(rule);
    signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
  }
  const duplicateGroups = [...signatures.values()].filter((count) => count >= 2).length;
  const broadRules = rules.filter((rule) =>
    rule.conditions?.some(
      (condition) =>
        ["contains", "matches"].includes(condition.op) &&
        typeof condition.value === "string" &&
        condition.value.trim().length < 3
    )
  ).length;
  const impossibleRules = rules.filter((rule) => {
    if ((rule.conditionsOp ?? "and") !== "and") return false;
    const byField = new Map();
    for (const condition of rule.conditions ?? []) {
      const list = byField.get(condition.field) ?? [];
      list.push(condition);
      byField.set(condition.field, list);
    }
    return [...byField.values()].some((conditions) => {
      const greater = conditions.find((condition) => ["gt", "gte"].includes(condition.op));
      const lower = conditions.find((condition) => ["lt", "lte"].includes(condition.op));
      return greater && lower && Number(greater.value) >= Number(lower.value);
    });
  }).length;
  let nearDuplicatePairs = 0;
  let shadowPatterns = 0;
  for (let leftIndex = 0; leftIndex < rules.length; leftIndex++) {
    const left = rules[leftIndex];
    const leftParts = new Set([
      ...(left.conditions ?? []).map((part) => JSON.stringify(part)),
      ...(left.actions ?? []).map((part) => JSON.stringify(part)),
    ]);
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex++) {
      const right = rules[rightIndex];
      if (
        (left.stage ?? null) !== (right.stage ?? null) ||
        (left.conditionsOp ?? "and") !== (right.conditionsOp ?? "and")
      ) {
        continue;
      }
      const rightParts = new Set([
        ...(right.conditions ?? []).map((part) => JSON.stringify(part)),
        ...(right.actions ?? []).map((part) => JSON.stringify(part)),
      ]);
      const diff =
        [...leftParts].filter((part) => !rightParts.has(part)).length +
        [...rightParts].filter((part) => !leftParts.has(part)).length;
      if (stableRuleSignature(left) !== stableRuleSignature(right) && [1, 2].includes(diff)) {
        nearDuplicatePairs++;
      }

      const [leftCondition] = left.conditions ?? [];
      const [rightCondition] = right.conditions ?? [];
      if (
        left.conditions?.length === 1 &&
        right.conditions?.length === 1 &&
        leftCondition.field === rightCondition.field &&
        leftCondition.op === "contains" &&
        rightCondition.op === "contains" &&
        typeof leftCondition.value === "string" &&
        typeof rightCondition.value === "string" &&
        (leftCondition.value.includes(rightCondition.value) ||
          rightCondition.value.includes(leftCondition.value)) &&
        JSON.stringify(left.actions) === JSON.stringify(right.actions)
      ) {
        shadowPatterns++;
      }
    }
  }

  if (
    duplicateGroups < 2 ||
    nearDuplicatePairs < 2 ||
    shadowPatterns < 1 ||
    broadRules < 1 ||
    impossibleRules < 1
  ) {
    throw new Error(
      `rule showcase incomplete: duplicateGroups=${duplicateGroups}, nearDuplicates=${nearDuplicatePairs}, shadowPatterns=${shadowPatterns}, broad=${broadRules}, impossible=${impossibleRules}`
    );
  }

  return {
    duplicateGroups,
    nearDuplicatePairs,
    shadowPatterns,
    broadRules,
    impossibleRules,
  };
}

async function createBudgetDataset(api, apiRuntime, demoBudget, months) {
  if (demoBudget.mode === "tracking") {
    await apiRuntime.send("preferences/save", { id: "budgetType", value: "tracking" });
  }

  const random = createSeededRandom();
  const rint = (min, max) => Math.floor(random() * (max - min + 1)) + min;
  const pick = (items) => items[Math.floor(random() * items.length)];
  const dateString = (month, day) => `${month.y}-${pad(month.mIdx + 1)}-${pad(day)}`;
  const logicalTransactions = [];
  const eventMonths = new Map();
  let importedCounter = 0;

  // ── accounts ──────────────────────────────────────────────────────────────
  const account = {};
  account.checking = await api.createAccount(
    { name: "Household Checking", type: "checking" },
    0
  );
  account.savings = await api.createAccount(
    { name: "High-Yield Savings", type: "savings" },
    0
  );
  account.credit = await api.createAccount(
    { name: "Everyday Rewards Card", type: "credit" },
    0
  );
  account.cash = await api.createAccount({ name: "Cash Wallet", type: "cash" }, 0);
  account.brokerage = await api.createAccount(
    { name: "Brokerage", type: "investment", offbudget: true },
    0
  );
  account.closed = await api.createAccount(
    { name: "Old Checking (Closed)", type: "checking" },
    0
  );
  await api.closeAccount(account.closed);

  // Account creation automatically creates transfer payees. Capture them once
  // so savings contributions and card payments become real paired transfers.
  const accountPayees = await api.getPayees();
  const transferPayee = Object.fromEntries(
    accountPayees
      .filter((candidate) => candidate.transfer_acct)
      .map((candidate) => [candidate.transfer_acct, candidate.id])
  );

  // ── category groups + categories ──────────────────────────────────────────
  const existingGroups = await api.getCategoryGroups();
  const category = {};
  const group = {};
  for (const definition of CATEGORY_GROUPS) {
    if (definition.income) {
      group[definition.key] =
        existingGroups.find((candidate) => candidate.is_income)?.id ??
        (await api.createCategoryGroup({ name: definition.name, is_income: true }));
    } else {
      group[definition.key] = await api.createCategoryGroup({ name: definition.name });
    }

    for (const [key, name] of definition.categories) {
      category[key] = await api.createCategory({
        name,
        group_id: group[definition.key],
        ...(definition.income ? { is_income: true } : {}),
        ...(key === "legacyCable" ? { hidden: true } : {}),
      });
    }
  }

  // ── payees ────────────────────────────────────────────────────────────────
  const payee = {};
  const payeeDefinitions = {
    primaryEmployer: "Northstar Design Studio",
    secondaryEmployer: "Riverside Community College",
    payrollBonus: "Northstar Annual Bonus",
    bankInterest: "Savings Interest",
    mortgage: "Oak Street Mortgage",
    electric: "Metro Electric",
    gasUtility: "County Natural Gas",
    water: "City Water & Sewer",
    internet: "Fiberlink Internet",
    mobile: "TalkMobile Family Plan",
    contractor: "Brightside Home Repair",
    homeInsurance: "Harbor Home Insurance",
    wholeFoods: "Whole Foods",
    wholeFoodsMarket: "Whole Foods Market",
    traderJoes: "Trader Joe's",
    safeway: "Safeway",
    safewayStore: "Safeway Store #1842",
    costco: "Costco",
    localMarket: "Saturday Farmers Market",
    chipotle: "Chipotle",
    italian: "The Italian Place",
    sushi: "Sakura Sushi",
    pizza: "Corner Pizza",
    cafe: "Riverside Cafe",
    starbucks: "Starbucks",
    starbucksCoffee: "Starbucks Coffee",
    blueBottle: "Blue Bottle Coffee",
    shell: "Shell",
    shellOil: "Shell Oil",
    chevron: "Chevron",
    metroTransit: "Metro Transit",
    autoInsurance: "Harbor Auto Insurance",
    mechanic: "Reliable Auto Care",
    dmv: "State DMV",
    parking: "ParkMobile",
    carLoan: "Community Auto Finance",
    healthInsurance: "Evergreen Health Plan",
    clinic: "Lakeside Family Clinic",
    dentist: "Bright Smile Dental",
    cvs: "CVS Pharmacy",
    gym: "FitLife Gym",
    childcare: "Little Oaks Childcare",
    school: "Maple Elementary PTA",
    soccer: "City Youth Soccer",
    veterinarian: "Greenwood Veterinary",
    petStore: "Neighborhood Pet Supply",
    target: "Target",
    amazon: "Amazon",
    amazonCom: "Amazon.com",
    amazonMarketplace: "AMZN Mktp",
    salon: "Juniper Hair Studio",
    cinema: "Grand Cinema",
    netflix: "Netflix",
    spotify: "Spotify",
    cloudStorage: "CloudBox Storage",
    craftStore: "Makers & Co.",
    giftShop: "The Gift Shop",
    charity: "Community Food Bank",
    studentLoan: "Federal Student Aid",
    airline: "SkyHigh Airlines",
    hotel: "Harborview Hotel",
    museum: "City Science Museum",
    officeStore: "Office Supply Depot",
    reimbursement: "Northstar Expense Reimbursement",
    taxPreparer: "Smith Tax Services",
    oldSubscription: "Old Subscription (Cancelled)",
    unknownMarket: "SQ *UNKNOWN MARKET",
    vanguard: "Vanguard",
  };
  for (const [key, name] of Object.entries(payeeDefinitions)) {
    payee[key] = await api.createPayee({ name });
  }

  // ── tags ──────────────────────────────────────────────────────────────────
  for (const [tag, color, description] of TAGS) {
    await api.createTag({ tag, color, description });
  }

  // ── rules ─────────────────────────────────────────────────────────────────
  const setCategory = (categoryId) => ({ op: "set", field: "category", value: categoryId });
  const setPayee = (payeeId) => ({ op: "set", field: "payee", value: payeeId });
  const payeeIs = (payeeId) => ({ field: "payee", op: "is", value: payeeId });
  const importedContains = (value) => ({ field: "imported_payee", op: "contains", value });
  const ruleDefinitions = [];
  const addRule = (conditions, actions, options = {}) => {
    ruleDefinitions.push({
      stage: options.stage ?? null,
      conditionsOp: options.conditionsOp ?? "and",
      conditions,
      actions,
    });
  };

  const healthyCategoryRules = [
    ["wholeFoods", "groceries"],
    ["traderJoes", "groceries"],
    ["costco", "groceries"],
    ["chipotle", "restaurants"],
    ["italian", "restaurants"],
    ["sushi", "restaurants"],
    ["shell", "fuel"],
    ["chevron", "fuel"],
    ["netflix", "subscriptions"],
    ["spotify", "subscriptions"],
    ["gym", "fitness"],
    ["cvs", "pharmacy"],
    ["petStore", "petSupplies"],
    ["childcare", "childcare"],
    ["studentLoan", "studentLoan"],
    ["primaryEmployer", "primarySalary"],
    ["secondaryEmployer", "secondarySalary"],
    ["charity", "charity"],
  ];
  for (const [payeeKey, categoryKey] of healthyCategoryRules) {
    addRule([payeeIs(payee[payeeKey])], [setCategory(category[categoryKey])]);
  }
  addRule([importedContains("AMZN")], [setPayee(payee.amazon)]);
  addRule([importedContains("UBER")], [setCategory(category.transit)]);
  addRule([importedContains("SAFEWAY")], [setCategory(category.groceries)]);

  // Two exact duplicate groups.
  addRule([payeeIs(payee.starbucks)], [setCategory(category.coffee)]);
  addRule([payeeIs(payee.starbucks)], [setCategory(category.coffee)]);
  addRule([payeeIs(payee.amazon)], [setCategory(category.household)]);
  addRule([payeeIs(payee.amazon)], [setCategory(category.household)]);

  // Near duplicate: same import match, different category action.
  addRule([importedContains("UBER TRIP")], [setCategory(category.transit)]);
  addRule([importedContains("UBER TRIP")], [setCategory(category.parking)]);

  // Shadowed: the earlier SAFEWAY condition is a superset and writes the same field/value.
  addRule([importedContains("SAFEWAY STORE")], [setCategory(category.groceries)]);

  // Broad and contradictory examples recognized by the current analyzer.
  addRule([importedContains("A")], [setCategory(category.miscellaneous)], { stage: "pre" });
  addRule(
    [
      { field: "amount", op: "gt", value: 10000 },
      { field: "amount", op: "lt", value: 5000 },
    ],
    [setCategory(category.miscellaneous)],
    { stage: "post" }
  );

  // Create user rules after historical transactions so intentionally broad or
  // conflicting diagnostic examples do not rewrite the curated source data.
  const intendedRuleShowcase = validateRuleShowcase(ruleDefinitions);

  // ── schedules ─────────────────────────────────────────────────────────────
  const current = months.at(-1);
  const monthlyOn = (day) => ({
    frequency: "monthly",
    interval: 1,
    start: dateString(current, Math.min(day, current.dayLimit)),
  });
  const scheduleDefinitions = [
    ["Primary Paycheck", account.checking, payee.primaryEmployer, 570000, 1],
    ["Secondary Paycheck", account.checking, payee.secondaryEmployer, 340000, 15],
    ["Mortgage", account.checking, payee.mortgage, -185000, 1],
    ["Health Insurance", account.checking, payee.healthInsurance, -46000, 2],
    ["Childcare", account.checking, payee.childcare, -78000, 3],
    ["Student Loan", account.checking, payee.studentLoan, -28000, 4],
    ["Car Payment", account.checking, payee.carLoan, -38000, 5],
    ["Internet", account.checking, payee.internet, -7500, 7],
    ["Mobile Phones", account.checking, payee.mobile, -9500, 10],
    ["Fitness Membership", account.credit, payee.gym, -5000, 12],
    ["Streaming Bundle", account.credit, payee.netflix, -2199, 8],
    ["Emergency Fund Transfer", account.checking, transferPayee[account.savings], -25000, 16],
  ];
  for (const [name, accountId, payeeId, amount, day] of scheduleDefinitions) {
    await api.createSchedule({
      name,
      account: accountId,
      payee: payeeId,
      amount,
      amountOp: "is",
      date: monthlyOn(day),
      posts_transaction: false,
    });
  }

  // ── transaction helpers ───────────────────────────────────────────────────
  const push = async (accountKey, transactions, { transfers = false } = {}) => {
    if (transactions.length === 0) return;
    logicalTransactions.push(
      ...transactions.map((transaction) => ({
        account: accountKey,
        date: transaction.date,
        amount: transaction.amount,
        payee: transaction._payeeKey ?? null,
        category: transaction._categoryKey ?? null,
        notes: transaction.notes ?? null,
        imported_payee: transaction.imported_payee ?? null,
        cleared: transaction.cleared ?? false,
        reconciled: transaction.reconciled ?? false,
        subtransactions: transaction.subtransactions?.map((child) => ({
          amount: child.amount,
          category: child._categoryKey,
          notes: child.notes ?? null,
        })) ?? null,
      }))
    );
    const apiTransactions = transactions.map((transaction) => {
      const clean = { ...transaction };
      delete clean._payeeKey;
      delete clean._categoryKey;
      if (clean.subtransactions) {
        clean.subtransactions = clean.subtransactions.map((child) => {
          const { _categoryKey: childCategoryKey, ...cleanChild } = child;
          return { ...cleanChild, category: category[childCategoryKey] };
        });
      }
      return clean;
    });
    await api.addTransactions(account[accountKey], apiTransactions, {
      learnCategories: false,
      runTransfers: transfers,
    });
  };
  const transaction = (month, day, payeeKey, amount, categoryKey, options = {}) => ({
    date: dateString(month, day),
    payee: payeeKey ? payee[payeeKey] : null,
    amount,
    ...(categoryKey ? { category: category[categoryKey] } : {}),
    imported_id: `demo-${month.key}-${pad(++importedCounter)}`,
    imported_payee: options.importedPayee ?? (payeeKey ? payeeDefinitions[payeeKey] : undefined),
    cleared: options.cleared ?? true,
    reconciled: options.reconciled ?? !month.isCurrent,
    ...(options.notes ? { notes: options.notes } : {}),
    ...(options.subtransactions ? { subtransactions: options.subtransactions } : {}),
    _payeeKey: payeeKey,
    _categoryKey: categoryKey,
  });
  const canPost = (month, day) => !month.isCurrent || day <= month.dayLimit;
  const scaled = (amount, factor) => Math.max(100, Math.round(amount * factor));

  const oldest = months[0];
  const openingBalances = [
    ["checking", 640000, "Opening household checking balance"],
    ["savings", 2800000, "Opening emergency and sinking-fund balance"],
    ["credit", -118000, "Opening credit card balance"],
    ["cash", 20000, "Opening cash balance"],
    ["brokerage", 8500000, "Opening off-budget investment balance"],
  ];
  for (const [accountKey, amount, notes] of openingBalances) {
    await push(accountKey, [
      {
        ...transaction(oldest, 1, null, amount, null, { notes }),
        starting_balance_flag: true,
      },
    ]);
  }

  const groceryPayees = ["wholeFoods", "wholeFoodsMarket", "traderJoes", "safeway", "safewayStore"];
  const restaurantPayees = ["chipotle", "italian", "sushi", "pizza", "cafe"];
  const coffeePayees = ["starbucks", "starbucksCoffee", "blueBottle"];
  const fuelPayees = ["shell", "shellOil", "chevron"];

  for (let monthIndex = 0; monthIndex < months.length; monthIndex++) {
    const month = months[monthIndex];
    const scenario = scenarioForMonth(month, monthIndex);
    eventMonths.set(scenario.label, month.key);
    const historical = !month.isCurrent;

    const checkingTransactions = [];
    if (canPost(month, 1)) {
      checkingTransactions.push(
        transaction(month, 1, "primaryEmployer", 570000 + scenario.incomeAdjustment, "primarySalary", {
          notes: scenario.label === "lower-income" ? "Reduced hours this month" : "Monthly payroll",
        }),
        transaction(month, 1, "mortgage", -185000, "mortgage"),
        transaction(month, 2, "healthInsurance", -46000, "healthInsurance"),
        transaction(month, 3, "childcare", -78000, "childcare"),
        transaction(month, 4, "studentLoan", -28000, "studentLoan"),
        transaction(month, 5, "carLoan", -38000, "carPayment")
      );
    }
    if (canPost(month, 6)) {
      checkingTransactions.push(
        transaction(month, 6, "electric", -rint(8500, [6, 7, 8].includes(month.monthNumber) ? 17500 : 13500), "electric"),
        transaction(month, 7, "internet", -7500, "internet"),
        transaction(month, 8, "gasUtility", -rint(3000, [12, 1, 2].includes(month.monthNumber) ? 14500 : 7500), "naturalGas"),
        transaction(month, 9, "water", -rint(5400, 7600), "water"),
        transaction(month, 10, "mobile", -9500, "mobile")
      );
    }
    if (canPost(month, 15)) {
      checkingTransactions.push(
        transaction(month, 15, "secondaryEmployer", 340000, "secondarySalary", {
          notes: "Adjunct teaching payroll",
        })
      );
    }
    if (canPost(month, 18)) {
      checkingTransactions.push(
        transaction(month, 18, "autoInsurance", -14000, "autoInsurance"),
        transaction(month, 19, "charity", -10000, "charity", { notes: "Monthly giving" })
      );
    }
    await push("checking", checkingTransactions);

    const transferTransactions = [];
    const addTransfer = (day, targetAccount, amount, categoryKey, note) => {
      if (!canPost(month, day)) return;
      transferTransactions.push({
        ...transaction(month, day, null, -amount, categoryKey, { notes: note }),
        payee: transferPayee[account[targetAccount]],
        _payeeKey: `transfer:${targetAccount}`,
      });
    };
    addTransfer(16, "savings", 25000, "emergencyFund", "Automatic emergency-fund contribution");
    addTransfer(17, "savings", 18000, "vacationFund", "Vacation sinking fund");
    addTransfer(20, "savings", 12000, "homeImprovement", "Home-project sinking fund");
    addTransfer(21, "savings", 15000, "annualBills", "Annual bills sinking fund #annual");
    addTransfer(24, "credit", 210000, null, "Monthly credit card payment");
    await push("checking", transferTransactions, { transfers: true });

    const creditTransactions = [];
    for (const day of [2, 7, 12, 17, 22, 27]) {
      if (!canPost(month, day)) continue;
      const payeeKey = pick(groceryPayees);
      creditTransactions.push(
        transaction(month, day, payeeKey, -scaled(rint(6500, 14500), scenario.groceryFactor), "groceries", {
          importedPayee: `${payeeDefinitions[payeeKey].toUpperCase()} ${rint(100, 999)}`,
        })
      );
    }
    for (const day of [5, 11, 19, 26]) {
      if (!canPost(month, day) || random() > 0.88) continue;
      const payeeKey = pick(restaurantPayees);
      creditTransactions.push(
        transaction(month, day, payeeKey, -scaled(rint(3200, 9200), scenario.restaurantFactor), "restaurants", {
          notes: day === 11 && monthIndex % 3 === 0 ? "Dinner with family #shared" : undefined,
        })
      );
    }
    for (const day of [3, 9, 16, 24]) {
      if (!canPost(month, day)) continue;
      const payeeKey = pick(coffeePayees);
      creditTransactions.push(
        transaction(month, day, payeeKey, -scaled(rint(450, 950), scenario.discretionaryFactor), "coffee")
      );
    }
    for (const day of [6, 13, 20]) {
      if (!canPost(month, day)) continue;
      creditTransactions.push(
        transaction(month, day, "cafe", -scaled(rint(1200, 2400), scenario.discretionaryFactor), "workLunches", {
          notes: monthIndex % 4 === 0 ? "Client lunch #work #reimbursable" : "Workday lunch #work",
        })
      );
    }
    for (const day of [4, 14, 25]) {
      if (!canPost(month, day)) continue;
      creditTransactions.push(
        transaction(month, day, pick(fuelPayees), -rint(4200, 7200), "fuel")
      );
    }
    const recurringCredit = [
      [8, "netflix", -2199, "subscriptions"],
      [8, "spotify", -1199, "subscriptions"],
      [10, "cloudStorage", -999, "subscriptions"],
      [12, "gym", -5000, "fitness"],
      [14, "petStore", -rint(2800, 5200), "petSupplies"],
      [18, "parking", -rint(800, 2200), "parking"],
      [23, "parking", -rint(800, 2200), "parking"],
      [25, "salon", -scaled(rint(3500, 8500), scenario.discretionaryFactor), "personalCare"],
      [27, "cinema", -scaled(rint(2200, 6200), scenario.discretionaryFactor), "entertainment"],
    ];
    for (const [day, payeeKey, amount, categoryKey] of recurringCredit) {
      if (canPost(month, day)) creditTransactions.push(transaction(month, day, payeeKey, amount, categoryKey));
    }
    if (canPost(month, 15)) {
      const splitGroceries = -rint(8500, 12500);
      const splitHousehold = -rint(3500, 6500);
      creditTransactions.push(
        transaction(month, 15, "costco", splitGroceries + splitHousehold, null, {
          notes: "Warehouse trip split between food and household supplies",
          subtransactions: [
            { amount: splitGroceries, _categoryKey: "groceries", notes: "Food and pantry items" },
            { amount: splitHousehold, _categoryKey: "household", notes: "Cleaning and paper goods" },
          ],
        })
      );
    }
    if (canPost(month, 21) && monthIndex % 2 === 0) {
      creditTransactions.push(
        transaction(month, 21, "cvs", -rint(1800, 6200), "pharmacy", { notes: "Prescription refill #medical" })
      );
    }
    if (canPost(month, 22) && monthIndex % 3 === 0) {
      creditTransactions.push(
        transaction(month, 22, "target", -scaled(rint(4500, 12000), scenario.discretionaryFactor), "clothing")
      );
    }
    if (canPost(month, 23)) {
      creditTransactions.push(
        transaction(month, 23, "amazonMarketplace", -rint(1800, 7500), null, {
          importedPayee: `AMZN Mktp US*${rint(1000, 9999)}`,
          notes: "Imported purchase awaiting rule review #review",
          cleared: historical,
          reconciled: false,
        })
      );
    }
    if (canPost(month, 26) && monthIndex % 2 === 1) {
      creditTransactions.push(
        transaction(month, 26, "veterinarian", -rint(5500, 14500), "petCare", { notes: "Routine pet care" })
      );
    }
    if (canPost(month, 28)) {
      creditTransactions.push(
        transaction(month, 28, "unknownMarket", -rint(1200, 4800), null, {
          importedPayee: `SQ *UNKNOWN MARKET ${rint(10, 99)}`,
          notes: "Needs category confirmation #review",
          cleared: false,
          reconciled: false,
        })
      );
    }

    if (scenario.event === "carRepair" && canPost(month, 13)) {
      creditTransactions.push(
        transaction(month, 13, "mechanic", -248400, "autoMaintenance", {
          notes: "Unexpected transmission repair",
        })
      );
    }
    if (scenario.event === "medicalDeductible" && canPost(month, 13)) {
      creditTransactions.push(
        transaction(month, 13, "clinic", -156500, "medical", {
          notes: "Annual deductible #medical",
        }),
        transaction(month, 20, "dentist", -58200, "dental", {
          notes: "Dental work #medical",
        })
      );
    }
    if (scenario.event === "vacation" && canPost(month, 12)) {
      creditTransactions.push(
        transaction(month, 12, "airline", -68400, "vacationFund", { notes: "Family flights #vacation" }),
        transaction(month, 18, "hotel", -112000, "vacationFund", { notes: "Summer trip hotel #vacation" }),
        transaction(month, 19, "museum", -8600, "vacationFund", { notes: "Family museum day #vacation" })
      );
    }
    if (scenario.event === "holiday" && canPost(month, 10)) {
      creditTransactions.push(
        transaction(month, 10, "giftShop", -75000, "gifts", { notes: "Holiday gifts #gift" }),
        transaction(month, 17, "amazon", -90000, "gifts", { notes: "Family presents #gift" }),
        transaction(month, 21, "airline", -95000, "vacationFund", { notes: "Holiday visit #vacation #shared" })
      );
    }
    if (month.monthNumber === 5 && canPost(month, 11)) {
      creditTransactions.push(
        transaction(month, 11, "dmv", -17600, "registration", { notes: "Annual registration #annual" })
      );
    }
    if ([3, 4, 5].includes(month.monthNumber) && canPost(month, 20)) {
      creditTransactions.push(
        transaction(month, 20, "contractor", -rint(16000, 34000), "homeMaintenance", {
          notes: "Seasonal home maintenance #home-project",
        })
      );
    }
    await push("credit", creditTransactions);

    const cashTransactions = [];
    if (canPost(month, 10)) {
      cashTransactions.push(
        transaction(month, 10, "localMarket", -rint(1800, 4200), "groceries", { notes: "Cash farmers market" })
      );
    }
    if (canPost(month, 24)) {
      cashTransactions.push(
        transaction(month, 24, "museum", -rint(800, 2200), "entertainment", { notes: "Family outing" })
      );
    }
    await push("cash", cashTransactions);

    const savingsTransactions = [];
    if (canPost(month, 15)) {
      savingsTransactions.push(
        transaction(month, 15, "bankInterest", rint(650, 1350), "interest", { notes: "Monthly interest" })
      );
    }
    await push("savings", savingsTransactions);

    const brokerageTransactions = [];
    if (canPost(month, 20)) {
      brokerageTransactions.push(
        transaction(month, 20, "vanguard", rint(2800, 6800), null, { notes: "Quarterly-style dividend #tax" })
      );
    }
    await push("brokerage", brokerageTransactions);

    if (scenario.event === "bonus" && canPost(month, 14)) {
      await push("checking", [
        transaction(month, 14, "payrollBonus", 180000, "bonus", { notes: "Annual performance bonus" }),
      ]);
    }
    if (canPost(month, 22) && monthIndex % 4 === 0) {
      await push("checking", [
        transaction(month, 22, "reimbursement", 8400, "reimbursements", {
          notes: "Client meal reimbursement #work #reimbursable",
        }),
      ]);
    }
  }

  for (const definition of ruleDefinitions) await api.createRule(definition);

  // ── budgets, carryover, holds, and notes ──────────────────────────────────
  const budgetSignature = [];
  await api.batchBudgetUpdates(async () => {
    for (const month of months) {
      const plan = budgetPlanForMonth(month);
      for (const [key, value] of Object.entries(plan)) {
        await api.setBudgetAmount(month.key, category[key], value);
        budgetSignature.push([month.key, key, value]);
      }
      for (const key of ["emergencyFund", "vacationFund", "homeImprovement", "annualBills"]) {
        await api.setBudgetCarryover(month.key, category[key], true);
      }
      if (demoBudget.mode === "tracking") {
        await api.setBudgetAmount(month.key, category.primarySalary, 570000);
        await api.setBudgetAmount(month.key, category.secondarySalary, 340000);
        await api.setBudgetAmount(month.key, category.interest, 950);
        await api.setBudgetAmount(month.key, category.reimbursements, 2100);
        if (scenarioForMonth(month, months.indexOf(month)).event === "bonus") {
          await api.setBudgetAmount(month.key, category.bonus, 180000);
        }
      }
    }
  });
  if (demoBudget.mode === "envelope") {
    await api.holdBudgetForNextMonth(current.key, 50000);
  }

  await api.updateNote(
    `account-${account.checking}`,
    "Primary household operating account. Paychecks land here and recurring bills are paid from it."
  );
  await api.updateNote(
    category.emergencyFund,
    "Long-term reserve. This category rolls over each month toward roughly six months of essential expenses."
  );
  await api.updateNote(
    category.vacationFund,
    "Sinking fund used for the planned summer family trip."
  );
  for (const [label, monthKey] of eventMonths) {
    if (label === "bad-car-repair") {
      await api.updateNote(`budget-${monthKey}`, "Unexpected car repair made this a difficult month.");
      await api.updateNote(`${category.autoMaintenance}-${monthKey}`, "Transmission repair exceeded the monthly plan.");
    }
    if (label === "bad-medical") {
      await api.updateNote(`budget-${monthKey}`, "Medical deductible and dental work drove this month's variance.");
    }
    if (label === "planned-vacation") {
      await api.updateNote(`budget-${monthKey}`, "Planned vacation spending was funded through the rollover category.");
    }
    if (label === "bad-holiday") {
      await api.updateNote(`budget-${monthKey}`, "Holiday travel, gifts, and dining ran above plan.");
    }
    if (label === "good") {
      await api.updateNote(`budget-${monthKey}`, "A lower-discretionary-spending month created extra breathing room.");
    }
  }

  // ── post-generation validation ─────────────────────────────────────────────
  const [
    accounts,
    visibleCategories,
    hiddenCategories,
    payees,
    ruleRows,
    schedules,
    tags,
    transactions,
  ] = await Promise.all([
    api.getAccounts(),
    api.getCategories(),
    api.getCategories({ hidden: true }),
    api.getPayees(),
    queryRows(api, "rules", ["id", "stage", "conditions", "actions", "conditions_op"]),
    api.getSchedules(),
    api.getTags(),
    queryRows(
      api,
      "transactions",
      [
        "id",
        "date",
        "amount",
        "notes",
        "imported_id",
        "cleared",
        "reconciled",
        "is_parent",
        "is_child",
        "transfer_id",
      ],
      { splits: "all" }
    ),
  ]);
  const categories = [...visibleCategories, ...hiddenCategories].filter(
    (candidate, index, all) =>
      all.findIndex((other) => other.id === candidate.id) === index
  );
  const taggedTransactions = transactions.filter((row) => /(^|\s)#[\w-]+/.test(row.notes ?? ""));
  const splitParents = transactions.filter((row) => row.is_parent);
  const splitChildren = transactions.filter((row) => row.is_child);
  const transfers = transactions.filter((row) => row.transfer_id);
  const imported = transactions.filter((row) => row.imported_id);
  const uncleared = transactions.filter((row) => !row.cleared);
  const reconciled = transactions.filter((row) => row.reconciled);
  if (splitParents.length === 0) {
    console.log(
      "• transaction query sample:",
      JSON.stringify({
        first: transactions.slice(0, 2),
        warehouse: transactions.find((row) => row.notes?.includes("Warehouse")),
      })
    );
  }
  const expectedMinimums = {
    // getAccounts() lists active accounts; the sixth account is intentionally closed.
    accounts: 5,
    categories: 50,
    payees: 60,
    rules: 30,
    schedules: 12,
    tags: 10,
    transactions: 500,
    taggedTransactions: 30,
    splitParents: 10,
    splitChildren: 20,
    transfers: 80,
    imported: 450,
    uncleared: 10,
    reconciled: 400,
  };
  const actualCounts = {
    accounts: accounts.length,
    categories: categories.length,
    payees: payees.length,
    rules: ruleRows.length,
    schedules: schedules.length,
    tags: tags.length,
    transactions: transactions.length,
    taggedTransactions: taggedTransactions.length,
    splitParents: splitParents.length,
    splitChildren: splitChildren.length,
    transfers: transfers.length,
    imported: imported.length,
    uncleared: uncleared.length,
    reconciled: reconciled.length,
  };
  for (const [key, minimum] of Object.entries(expectedMinimums)) {
    if (actualCounts[key] < minimum) {
      throw new Error(`${demoBudget.name}: expected at least ${minimum} ${key}, found ${actualCounts[key]}`);
    }
  }

  const preferences = await api.getPreferences();
  const actualMode = preferences.budgetType === "tracking" ? "tracking" : "envelope";
  if (actualMode !== demoBudget.mode) {
    throw new Error(`${demoBudget.name} mode mismatch: expected ${demoBudget.mode}, got ${actualMode}`);
  }

  return {
    counts: {
      ...actualCounts,
      months: months.length,
      mode: actualMode,
      ...intendedRuleShowcase,
    },
    logicalSignature: JSON.stringify(logicalTransactions),
    budgetSignature: JSON.stringify(budgetSignature),
  };
}

async function stabilizeGeneratedSyncIds(generatedBudgets) {
  const Database = require("better-sqlite3");
  const accountDb = new Database(join(SEED_DATA_DIR, "server-files", "account.sqlite"));
  try {
    const update = accountDb.prepare("UPDATE files SET group_id = ? WHERE group_id = ?");
    const applyUpdates = accountDb.transaction(() => {
      for (const budget of generatedBudgets) {
        const result = update.run(budget.stableGroupId, budget.groupId);
        if (result.changes !== 1) {
          throw new Error(`could not stabilize Sync ID for ${budget.name}`);
        }
      }
    });
    applyUpdates();
  } finally {
    accountDb.close();
  }

  for (const budget of generatedBudgets) {
    await rename(
      join(SEED_DATA_DIR, "user-files", `group-${budget.groupId}.sqlite`),
      join(SEED_DATA_DIR, "user-files", `group-${budget.stableGroupId}.sqlite`)
    );
  }

  return generatedBudgets.map((budget) => ({
    ...budget,
    generatedGroupId: budget.groupId,
    groupId: budget.stableGroupId,
  }));
}

async function main() {
  await rm(SEED_DATA_DIR, { recursive: true, force: true });
  await mkdir(SEED_DATA_DIR, { recursive: true });

  const serverBin = require.resolve("@actual-app/sync-server/build/bin/actual-server.js");
  const shimPath = join(await mkdtemp(join(tmpdir(), "actual-shim-")), "shim.cjs");
  await writeFile(shimPath, "globalThis.navigator ??= { platform: '', userAgent: 'node' };\n");

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
  let generatedBudgets;

  try {
    await waitForServer();
    console.log("• sync server is up");

    const bootstrap = await fetch(`${SERVER_URL}/account/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    if (!bootstrap.ok && bootstrap.status !== 400) {
      throw new Error(`bootstrap failed: ${bootstrap.status} ${await bootstrap.text()}`);
    }

    const api = require("@actual-app/api");
    const apiDataDir = await mkdtemp(join(tmpdir(), "actual-seed-"));
    console.log("• connecting api client...");
    const apiRuntime = await api.init({
      dataDir: apiDataDir,
      serverURL: SERVER_URL,
      password: PASSWORD,
    });

    const months = buildMonths();
    const results = [];
    for (const demoBudget of DEMO_BUDGETS) {
      console.log(`• creating ${demoBudget.name} (${demoBudget.mode})...`);
      let result;
      await api.runImport(demoBudget.name, async () => {
        result = await createBudgetDataset(api, apiRuntime, demoBudget, months);
      });
      if (!result) throw new Error(`dataset counts were not captured for ${demoBudget.name}`);
      console.log("• dataset:", JSON.stringify(result.counts));
      console.log(`• syncing ${demoBudget.name} to server...`);
      await api.sync();
      results.push(result);
    }

    if (
      results[0].logicalSignature !== results[1].logicalSignature ||
      results[0].budgetSignature !== results[1].budgetSignature
    ) {
      throw new Error("Envelope and Tracking source datasets are not equivalent");
    }
    console.log("• verified equivalent transactions and expense plans across both modes");
    await api.shutdown();

    const login = await fetch(`${SERVER_URL}/account/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const token = (await login.json())?.data?.token;
    const list = await fetch(`${SERVER_URL}/sync/list-user-files`, {
      headers: { "X-ACTUAL-TOKEN": token ?? "" },
    });
    const activeFiles = ((await list.json())?.data ?? []).filter((file) => !file.deleted);
    if (activeFiles.length !== DEMO_BUDGETS.length) {
      throw new Error(`expected ${DEMO_BUDGETS.length} active demo budgets, found ${activeFiles.length}`);
    }

    generatedBudgets = DEMO_BUDGETS.map((demoBudget) => {
      const file = activeFiles.find((candidate) => candidate.name === demoBudget.name);
      if (!file?.groupId) throw new Error(`missing synced budget: ${demoBudget.name}`);
      return { ...demoBudget, groupId: file.groupId };
    });

  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exitPromise = once(server, "exit");
      server.kill("SIGTERM");
      await Promise.race([exitPromise, sleep(10000)]);
    }
    if (server.exitCode === null && server.signalCode === null) {
      const exitPromise = once(server, "exit");
      server.kill("SIGKILL");
      await exitPromise;
    }
  }

  if (!generatedBudgets) throw new Error("generated budget metadata was not captured");
  const stableBudgets = await stabilizeGeneratedSyncIds(generatedBudgets);

  console.log("\n────────────────────────────────────────────────────");
  console.log("✅ Seed budgets generated → demo/seed-data/");
  console.log("");
  for (const budget of stableBudgets) {
    console.log(`  ${budget.envName} :`, budget.groupId);
  }
  console.log("  ACTUAL_SERVER_PASSWORD:", PASSWORD);
  console.log("");
  console.log("The stable Sync IDs remain compatible with the Demo UI environment.");
  console.log("────────────────────────────────────────────────────");
}

main().catch((error) => {
  console.error("seed generation failed:", error);
  process.exit(1);
});
