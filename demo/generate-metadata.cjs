#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- These Node scripts load CommonJS modules. */
/* Build the demo-only Bench database through the same repositories as the app. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
// The app's TypeScript modules use @/ aliases. The seed runs directly in Node,
// without adding a second runtime dependency or bundling a second app.
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);
};
require.extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
};
const { getAppDb } = require('../src/lib/app-db/connection.ts');
const { applyAccountClassChanges } = require('../src/lib/app-db/accountClassRepository.ts');
const { saveAsset, saveBookMetadata, readRegistry } = require('../src/lib/app-db/assetRepository.ts');
const { saveAssetDebtAllocation } = require('../src/lib/app-db/assetDebtLinkRepository.ts');
const { loanFingerprint } = require('../src/lib/asset-registry/financing.ts');
const { createDebtConfiguration } = require('../src/lib/assets-debt/services/debtConfigService.ts');
const { recordManualDebtObservation } = require('../src/lib/assets-debt/services/observationService.ts');
const { anchorDebtAtObservation } = require('../src/lib/assets-debt/services/anchorService.ts');
const { projectStoredDebt } = require('../src/lib/assets-debt/services/projectionService.ts');
const { simulate } = require('../src/lib/financial-models/loan/projection.ts');
const { modelFromDetail } = require('../src/lib/assets-debt/model/buildModel.ts');
const { saveLedgerEntries } = require('../src/lib/app-db/debtTrackingRepository.ts');
const { applyCreditCardChanges } = require('../src/lib/app-db/creditCardRepository.ts');
const { EMPTY_CHANGES } = require('../src/lib/credit-cards/changes.ts');
const { createReconciliationSession, updateReconciliationSession, replaceStatementRows, replaceReconciliationItems, listReconciliationItems, completeReconciliationWithoutWrites } = require('../src/lib/app-db/reconciliationRepository.ts');
const { decisionSignature } = require('../src/lib/reconciliation/session/signature.ts');
const { DEFAULT_APPLY_CONFIG } = require('../src/lib/reconciliation/session/plan.ts');
const manifest = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, 'seed-manifest.json'), 'utf8'));
const output = path.resolve(process.argv[3] || path.join(__dirname, 'seed-bench.sqlite'));
if (!output.startsWith(path.resolve(__dirname) + path.sep)) throw new Error('Demo database output must be inside demo/');
fs.rmSync(output, { force: true });
const db = getAppDb(output);
function loanConfig(openingDate, firstPaymentDate, openingPrincipalMinor, contractualPaymentMinor, termMonths) {
  return {
    format: 'rd084.debt-config', version: 1,
    terms: { openingDate, openingPrincipalMinor, maturityDate: null, contractualTermMonths: termMonths, amortizationTermMonths: termMonths, contractualPaymentMinor, creditLimitMinor: null, firstPaymentDate, firstInterestChargeDate: null },
    profile: { amortization: 'level-payment', rateQuote: 'nominal-simple-periodic', dayCount: 'actual-365-fixed', accrual: 'per-period', chargeFrequency: 'at-repayment', chargeDay: null, capitalization: 'at-charge', repaymentFrequency: 'monthly', repaymentDerivation: 'contractual-fixed', recast: 'never', rateEffectiveTiming: 'on-accrual-effective-date', repaymentEffectiveTiming: 'transaction-date', rounding: { paymentRounding: 'half-up', interestPostingRounding: 'half-up', intermediateScale: { mode: 'full' }, intermediateRounding: 'half-even', balancePrecision: 'round-each-posting' }, eventOrder: { timing: 'start-of-day' }, finalPayment: 'continue-until-paid', shortMonth: 'clamp-to-last-calendar-day', negativeAmortizationAllowed: false, interestOnlyRepayment: 'charged-interest-outstanding', presetId: null },
    phases: [], components: [
      { economicKind: 'principal', label: 'Principal', destination: 'transfer', categoryId: null, amountRule: 'calculated', fixedAmountMinor: null, treatment: null, order: 0 },
      { economicKind: 'interest', label: 'Interest', destination: 'category', categoryId: null, amountRule: 'calculated', fixedAmountMinor: null, treatment: null, order: 1 },
    ], paymentRecasts: [], revolving: null,
  };
}
function dateBefore(month) { const d = new Date(Date.UTC(month.y, month.mIdx - 1, 1)); return d.toISOString().slice(0, 10); }
for (const demo of manifest) {
  const budgetSyncId = demo.budgetSyncId;
  const a = demo.accounts, c = demo.categories;
  const first = demo.months[0], current = demo.months.at(-1);
  const openingDate = dateBefore(first);
  const directory = { budgetSyncId, accounts: [
    { id: a.checking, name: 'Household Checking', offBudget: false, closed: false },
    { id: a.mortgage, name: 'Home Mortgage', offBudget: true, closed: false },
    { id: a.carLoan, name: 'Car Loan', offBudget: true, closed: false },
  ], categories: [
    { id: c.mortgage, name: 'Mortgage', groupName: 'Housing', isIncome: false, hidden: false },
    { id: c.carPayment, name: 'Car Payment', groupName: 'Transportation', isIncome: false, hidden: false },
  ] };
  const debts = {};
  for (const spec of [
    { key: 'mortgage', name: 'Home Mortgage', type: 'mortgage', category: c.mortgage, amount: 28000000, payment: 185000, rate: '0.05', term: 360, day: '01' },
    { key: 'carLoan', name: 'Car Loan', type: 'other', category: c.carPayment, amount: 2200000, payment: 38000, rate: '0.06', term: 84, day: '05' },
  ]) {
    const loanOpening = openingDate.slice(0, 8) + spec.day;
    const detail = createDebtConfiguration(db, {
      budgetSyncId, name: spec.name, debtType: spec.type, behaviorClass: 'term-loan', currency: 'USD', currencyMinorDigits: 2,
      liabilityAccountId: a[spec.key], paymentAccountId: a.checking, signConvention: 'negative-is-debt', lenderPattern: 'separate-interest', executionStrategy: 'bench-periodic', lenderChargeGraceDays: 3, onboardingDate: null,
      loanPaymentCategoryId: spec.category, drawCategoryId: null, expectedObservationIntervalDays: null, status: 'active', trackingStartDueDate: `${first.key}-${spec.day}`,
      config: loanConfig(loanOpening, `${first.key}-${spec.day}`, spec.amount, spec.payment, spec.term),
      rates: [{ announcedAt: null, accrualEffectiveFrom: loanOpening, annualRateDecimal: spec.rate, paymentRecalcPolicy: null, paymentEffectiveFrom: null, rateCapDecimal: null, rateFloorDecimal: null, paymentCap: null, source: 'Fictional loan agreement', note: null }], offsets: [], assumptions: [],
    }, directory);
    const debtId = detail.debt.id;
    debts[spec.key] = debtId;
    const rows = demo.transactions[spec.key];
    const changes = rows.filter((row) => row.amount > 0).map((row) => ({ actualTransactionId: row.id, actualAccountId: a[spec.key], entryType: row.notes?.startsWith('Additional') ? 'extra-principal' : 'principal-repayment', ...(row.notes?.startsWith('Additional') ? {} : { installmentDueDate: row.date }), revision: 0 }));
    saveLedgerEntries(db, debtId, changes);
    const principalMinor = -rows.reduce((sum, row) => sum + row.amount, 0);
    const last = rows.filter((row) => row.amount > 0).map((row) => row.date).sort().at(-1);
    const model = modelFromDetail(detail);
    if (!model.ok) throw new Error(`${spec.name} model is blocked`);
    const extras = rows.filter((row) => row.notes?.startsWith('Additional')).map((row) => ({ kind: 'extra-repayment', date: row.date, amountMinor: row.amount, ref: { source: 'actual', id: row.id } }));
    const history = simulate({ model: model.model, anchor: { date: model.model.terms.openingDate, principalMinor: spec.amount, accruedInterestMinor: 0, source: 'opening' }, events: extras, to: last });
    if (!history.ok || history.closing.principalMinor !== principalMinor) throw new Error(`${spec.name} history does not match its Actual balance`);
    const observed = recordManualDebtObservation(db, { debtId, observedOn: last, recordedAt: `${last}T12:00:00.000Z`, principalMinor, accruedInterestMinor: 0, note: 'Fictional lender statement' });
    anchorDebtAtObservation(db, debtId, observed.id);
    const toYear = current.y + 2;
    const projection = projectStoredDebt(db, debtId, { from: last, to: `${toYear}-${String(current.monthNumber).padStart(2, '0')}-28`, resolution: 'monthly' });
    if (!projection.ok || !projection.projection.ok || projection.projection.events.length === 0) throw new Error(`${spec.name} projection is blocked: ${JSON.stringify(projection)}`);
  }
  applyAccountClassChanges(db, { budgetSyncId, changes: [{ scope: 'account', id: a.property, accountClass: 'property' }, { scope: 'account', id: a.vehicle, accountClass: 'vehicle' }] });
  for (const spec of [{ key: 'property', name: 'Family Home', type: 'real-estate', debt: 'mortgage' }, { key: 'vehicle', name: 'Family Car', type: 'vehicle', debt: 'carLoan' }]) {
    const id = `${budgetSyncId}-${spec.key}`;
    saveAsset(db, { budgetSyncId, asset: { id, actualAccountId: a[spec.key], name: spec.name, assetType: spec.type, description: null, status: 'active', revision: 0, ownership: [{ effectiveFrom: `${first.key}-01`, ownershipBps: 10000 }] }, accountDirectory: [{ id: a[spec.key], name: spec.name, offBudget: true, closed: false }] });
    saveBookMetadata(db, { budgetSyncId, changes: demo.transactions[spec.key].map((row) => ({ actualTransactionId: row.id, actualAccountId: a[spec.key], assetId: id, classification: row.starting_balance_flag ? 'opening-balance' : (spec.key === 'property' ? 'revaluation' : 'depreciation'), revision: 0 })) });
    const links = readRegistry(db, budgetSyncId).debtLinks ?? [];
    saveAssetDebtAllocation(db, { budgetSyncId, assetId: id, debtId: debts[spec.debt], expectedFingerprint: loanFingerprint(links, debts[spec.debt]), operation: { kind: 'set', effectiveFrom: `${first.key}-01`, allocationBps: 10000 } });
  }
  const cardId = `${budgetSyncId}-card`;
  const card = { id: cardId, budgetSyncId, accountId: a.credit, revision: 1, bankTimeZone: 'UTC', closingDay: 28, dueRule: { kind: 'day-of-month', value: 20 }, billingDaysSource: 'user', creditLimitMinor: 1500000 };
  const statements = demo.months.slice(-3, -1).map((month, index) => {
    const closingDate = `${month.key}-28`;
    const previous = demo.months[demo.months.indexOf(month) - 1];
    const periodStart = new Date(Date.UTC(previous.y, previous.mIdx, 29)).toISOString().slice(0, 10);
    const next = demo.months[demo.months.indexOf(month) + 1];
    const balanceMinor = -demo.transactions.credit.filter((row) => !row.is_child && row.date <= closingDate).reduce((sum, row) => sum + row.amount, 0);
    if (balanceMinor < 0) throw new Error('Card has credit at statement close');
    return { id: `${cardId}-statement-${index}`, cardId, revision: 1, periodStart, closingDate, dueDate: `${next.key}-20`, balanceMinor, minimumDueMinor: Math.min(balanceMinor, 5000), previousBalanceMinor: index === 0 ? -demo.transactions.credit.filter((row) => !row.is_child && row.date < periodStart).reduce((sum, row) => sum + row.amount, 0) : null };
  });
  applyCreditCardChanges(db, { budgetSyncId, changes: { ...EMPTY_CHANGES, cards: { put: [card], remove: [] }, statements: { put: statements, remove: [] } } });
  const lastMonth = demo.months.at(-2);
  const session = createReconciliationSession(db, { budgetSyncId, accountId: a.checking, accountName: 'Household Checking', statementName: `Checking ${lastMonth.key}.csv` });
  const rows = demo.transactions.checking.filter((row) => row.date.startsWith(lastMonth.key) && row.reconciled && !row.is_child).sort((x,y) => x.date.localeCompare(y.date));
  const statementRows = rows.map((row, i) => ({ id: `${budgetSyncId}-statement-row-${i}`, sourceRowNumber: i+2, postedDate: row.date, amount: row.amount, importedPayee: row.imported_payee || 'Household transaction', fingerprint: `demo-${row.id}`, raw: { date: row.date, amount: row.amount } }));
  replaceStatementRows(db, session.id, statementRows);
  replaceReconciliationItems(db, session.id, rows.map((row,i) => ({ id: `${budgetSyncId}-reconciliation-item-${i}`, statementRowIds: [statementRows[i].id], actualTransactionIds: [row.id], disposition: 'matched' })));
  updateReconciliationSession(db, session.id, { status: 'needs_review', statementFormat: 'delimited', statementStart: `${lastMonth.key}-01`, statementEnd: `${lastMonth.key}-28`, totals: { rowCount: rows.length, net: rows.reduce((sum,row) => sum + row.amount, 0) }, applyConfig: DEFAULT_APPLY_CONFIG });
  completeReconciliationWithoutWrites(db, session.id, decisionSignature(listReconciliationItems(db, session.id), DEFAULT_APPLY_CONFIG));
}
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log(`Generated demo Bench metadata for ${manifest.length} budgets`);
