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
const { saveAssetCashflows } = require('../src/lib/app-db/assetCashflowRepository.ts');
const { insertFxRate } = require('../src/lib/fx/repositories/fxRateRepository.ts');
const { createBackupDestination, createBackupPolicy } = require('../src/lib/app-db/backupRepository.ts');
const { reconcileBackupAutomations } = require('../src/lib/automation/jobs/backupReconcile.ts');
const { identityHash, financialFingerprint } = require('../src/features/credit-cards/lib/evidence.ts');
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
if (![path.join(__dirname, 'seed-bench.sqlite'), path.join(__dirname, 'seed-bench.next.sqlite')].includes(output)) throw new Error('Use a demo seed database path');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(output + suffix, { force: true });
const db = getAppDb(output);
function loanConfig(openingDate, firstPaymentDate, openingPrincipalMinor, contractualPaymentMinor, termMonths, interestCategoryId) {
  return {
    format: 'rd084.debt-config', version: 1,
    terms: { openingDate, openingPrincipalMinor, maturityDate: null, contractualTermMonths: termMonths, amortizationTermMonths: termMonths, contractualPaymentMinor, creditLimitMinor: null, firstPaymentDate, firstInterestChargeDate: null },
    profile: { amortization: 'level-payment', rateQuote: 'nominal-simple-periodic', dayCount: 'actual-365-fixed', accrual: 'per-period', chargeFrequency: 'at-repayment', chargeDay: null, capitalization: 'at-charge', repaymentFrequency: 'monthly', repaymentDerivation: 'contractual-fixed', recast: 'never', rateEffectiveTiming: 'on-accrual-effective-date', repaymentEffectiveTiming: 'transaction-date', rounding: { paymentRounding: 'half-up', interestPostingRounding: 'half-up', intermediateScale: { mode: 'full' }, intermediateRounding: 'half-even', balancePrecision: 'round-each-posting' }, eventOrder: { timing: 'start-of-day' }, finalPayment: 'continue-until-paid', shortMonth: 'clamp-to-last-calendar-day', negativeAmortizationAllowed: false, interestOnlyRepayment: 'charged-interest-outstanding', presetId: null },
    phases: [], components: [
      { economicKind: 'principal', label: 'Principal', destination: 'transfer', categoryId: null, amountRule: 'calculated', fixedAmountMinor: null, treatment: null, order: 0 },
      { economicKind: 'interest', label: 'Interest', destination: 'category', categoryId: interestCategoryId, amountRule: 'calculated', fixedAmountMinor: null, treatment: null, order: 1 },
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
    { id: a.personalLoan, name: 'Personal Loan', offBudget: true, closed: false },
    { id: a.rentalLoan, name: 'Investment Property Loan', offBudget: true, closed: false },
  ], categories: [
    { id: c.mortgage, name: 'Mortgage', groupName: 'Housing', isIncome: false, hidden: false },
    { id: c.carPayment, name: 'Car Payment', groupName: 'Transportation', isIncome: false, hidden: false },
    { id: c.personalPayment, name: 'Personal Loan Payment', groupName: 'Debt Payments', isIncome: false, hidden: false },
    { id: c.rentalMortgage, name: 'Rental Mortgage', groupName: 'Housing', isIncome: false, hidden: false },
  ] };
  const debts = {};
  for (const spec of [
    { key: 'mortgage', name: 'Home Mortgage', type: 'mortgage', category: c.mortgage, amount: 28000000, payment: 185000, rate: '0.05', term: 360, day: '01' },
    { key: 'carLoan', name: 'Car Loan', type: 'other', category: c.carPayment, amount: 2200000, payment: 38000, rate: '0.06', term: 84, day: '05' },
    { key: 'personalLoan', name: 'Personal Loan', type: 'other', category: c.personalPayment, amount: 1200000, payment: 25000, rate: '0.09', term: 60, day: '05' },
    { key: 'rentalLoan', name: 'Investment Property Loan', type: 'mortgage', category: c.rentalMortgage, amount: 15000000, payment: 100000, rate: '0.06', term: 360, day: '01' },
  ]) {
    const loanOpening = openingDate.slice(0, 8) + spec.day;
    const detail = createDebtConfiguration(db, {
      budgetSyncId, name: spec.name, debtType: spec.type, behaviorClass: 'term-loan', currency: 'USD', currencyMinorDigits: 2,
      liabilityAccountId: a[spec.key], paymentAccountId: a.checking, signConvention: 'negative-is-debt', lenderPattern: 'separate-interest', executionStrategy: 'bench-periodic', lenderChargeGraceDays: 3, onboardingDate: null,
      loanPaymentCategoryId: spec.category, drawCategoryId: null, expectedObservationIntervalDays: null, status: 'active', trackingStartDueDate: `${first.key}-${spec.day}`,
      config: loanConfig(loanOpening, `${first.key}-${spec.day}`, spec.amount, spec.payment, spec.term, spec.category),
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
  applyAccountClassChanges(db, { budgetSyncId, changes: Object.entries({ checking: 'bank', savings: 'bank', cash: 'cash', credit: 'credit-card', installmentCard: 'credit-card', brokerage: 'investment', property: 'property', rentalProperty: 'property', vehicle: 'vehicle', mortgage: 'loan', carLoan: 'loan', personalLoan: 'loan', rentalLoan: 'loan' }).map(([key, accountClass]) => ({ scope: 'account', id: a[key], accountClass })) });
  for (const spec of [{ key: 'property', name: 'Family Home', type: 'real-estate', debt: 'mortgage' }, { key: 'vehicle', name: 'Family Car', type: 'vehicle', debt: 'carLoan' }, { key: 'rentalProperty', name: 'Investment Property', type: 'real-estate', debt: 'rentalLoan' }]) {
    const id = `${budgetSyncId}-${spec.key}`;
    saveAsset(db, { budgetSyncId, asset: { id, actualAccountId: a[spec.key], name: spec.name, assetType: spec.type, description: null, status: 'active', revision: 0, ownership: [{ effectiveFrom: spec.key === 'property' ? demo.homeOpeningDate : `${first.key}-01`, ownershipBps: 10000 }] }, accountDirectory: [{ id: a[spec.key], name: spec.name, offBudget: true, closed: false }] });
    saveBookMetadata(db, { budgetSyncId, changes: demo.transactions[spec.key].map((row) => ({ actualTransactionId: row.id, actualAccountId: a[spec.key], assetId: id, classification: row.starting_balance_flag ? 'opening-balance' : (spec.key === 'vehicle' ? 'depreciation' : 'revaluation'), revision: 0 })) });
    const links = readRegistry(db, budgetSyncId).debtLinks ?? [];
    saveAssetDebtAllocation(db, { budgetSyncId, assetId: id, debtId: debts[spec.debt], expectedFingerprint: loanFingerprint(links, debts[spec.debt]), operation: { kind: 'set', effectiveFrom: `${first.key}-01`, allocationBps: 10000 } });
  }
  const rentalRows = demo.transactions.checking.filter((row) => row.notes?.includes('#rental-property') && !row.is_child);
  if (rentalRows.length < 2) throw new Error('Rental income and expenses are missing');
  saveAssetCashflows(db, { budgetSyncId,
    changes: rentalRows.map((row) => ({ role: 'cashflow', actualTransactionId: row.id, actualAccountId: a.checking, assetId: `${budgetSyncId}-rentalProperty`, classification: null, revision: 0 })),
    sources: rentalRows.map((row) => ({ id: row.id, accountId: a.checking, date: row.date, amountMinor: row.amount, parentId: null, transferId: row.transfer_id ?? null, categoryId: row.category ?? null, notes: row.notes ?? null })),
  });
  const cardId = `${budgetSyncId}-card`;
  const card = { id: cardId, budgetSyncId, accountId: a.credit, revision: 1, bankTimeZone: 'UTC', closingDay: 28, dueRule: { kind: 'day-of-month', value: 26 }, billingDaysSource: 'user', creditLimitMinor: 1500000 };
  const statements = demo.months.slice(-4, -1).map((month, index) => {
    const closingDate = `${month.key}-28`;
    const previous = demo.months[demo.months.indexOf(month) - 1];
    const periodStart = new Date(Date.UTC(previous.y, previous.mIdx, 29)).toISOString().slice(0, 10);
    const next = demo.months[demo.months.indexOf(month) + 1];
    const balanceMinor = -demo.transactions.credit.filter((row) => !row.is_child && row.date <= closingDate).reduce((sum, row) => sum + row.amount, 0);
    if (balanceMinor < 0) throw new Error('Card has credit at statement close');
    return { id: `${cardId}-statement-${index}`, cardId, revision: 1, periodStart, closingDate, dueDate: `${next.key}-26`, balanceMinor, minimumDueMinor: Math.min(balanceMinor, 5000), previousBalanceMinor: index === 0 ? -demo.transactions.credit.filter((row) => !row.is_child && row.date < periodStart).reduce((sum, row) => sum + row.amount, 0) : null };
  });
  const paid = (statement) => demo.transactions.credit.filter((row) => row.notes === 'Monthly credit card payment' && row.cleared && row.date > statement.closingDate && row.date <= statement.dueDate).reduce((sum, row) => sum + row.amount, 0);
  if (paid(statements[1]) < statements[1].balanceMinor || paid(statements[2]) >= statements[2].balanceMinor) throw new Error('Card payment examples do not match their statements');
  applyCreditCardChanges(db, { budgetSyncId, changes: { ...EMPTY_CHANGES, cards: { put: [card], remove: [] }, statements: { put: statements, remove: [] } } });
  const secondCardId = `${budgetSyncId}-installment-card`;
  const secondCard = { id: secondCardId, budgetSyncId, accountId: a.installmentCard, revision: 1, bankTimeZone: 'UTC', closingDay: 28, dueRule: { kind: 'day-of-month', value: 26 }, billingDaysSource: 'user', creditLimitMinor: 600000, autoPay: 'full' };
  const secondStatements = demo.months.slice(-4, -1).map((month, index) => {
    const previous = demo.months[demo.months.indexOf(month) - 1], next = demo.months[demo.months.indexOf(month) + 1];
    const closingDate = `${month.key}-28`, periodStart = new Date(Date.UTC(previous.y, previous.mIdx, 29)).toISOString().slice(0, 10);
    const balanceMinor = -demo.transactions.installmentCard.filter((row) => !row.is_child && row.date <= closingDate).reduce((sum, row) => sum + row.amount, 0);
    return { id: `${secondCardId}-statement-${index}`, cardId: secondCardId, revision: 1, periodStart, closingDate, dueDate: `${next.key}-26`, balanceMinor, minimumDueMinor: Math.min(balanceMinor, 5000), previousBalanceMinor: index === 0 ? -demo.transactions.installmentCard.filter((row) => !row.is_child && row.date < periodStart).reduce((sum, row) => sum + row.amount, 0) : null };
  });
  const planId = `${secondCardId}-laptop-plan`;
  const plan = { id: planId, cardId: secondCardId, revision: 1, name: 'Laptop instalments', recordedAs: 'card-instalments', originalAmountMinor: 120000, startDate: `${first.key}-01`, scheduleKind: 'fixed', firstDueDate: `${demo.months[1].key}-12`, instalmentCount: 12, instalmentMinor: 10000 };
  const planRows = demo.transactions.installmentCard.filter((row) => row.notes === 'Laptop installment #home-project').sort((x, y) => x.date.localeCompare(y.date)).map((row, i) => {
    const evidence = { id: row.id, accountId: a.installmentCard, date: row.date, amountMinor: row.amount, transferKnown: true, transferId: row.transfer_id ?? null, parentId: null };
    return { planId, transactionId: row.id, role: 'instalment', instalmentNumber: i + 1, transferPairKey: null, identityHash: identityHash(evidence), sourceHash: financialFingerprint(evidence) };
  });
  applyCreditCardChanges(db, { budgetSyncId, changes: { ...EMPTY_CHANGES, cards: { put: [secondCard], remove: [] }, statements: { put: secondStatements, remove: [] }, plans: { put: [plan], remove: [] }, planEntries: [{ planId, rows: planRows }] } });
  const lastMonth = demo.months.at(-2);
  const session = createReconciliationSession(db, { budgetSyncId, accountId: a.checking, accountName: 'Household Checking', statementName: `Checking ${lastMonth.key}.csv` });
  const rows = demo.transactions.checking.filter((row) => row.date.startsWith(lastMonth.key) && row.reconciled && !row.is_child).sort((x,y) => x.date.localeCompare(y.date));
  const statementRows = rows.map((row, i) => ({ id: `${budgetSyncId}-statement-row-${i}`, sourceRowNumber: i+2, postedDate: row.date, amount: row.amount, importedPayee: row.imported_payee || 'Household transaction', fingerprint: `demo-${row.id}`, raw: { date: row.date, amount: row.amount } }));
  replaceStatementRows(db, session.id, statementRows);
  replaceReconciliationItems(db, session.id, rows.map((row,i) => ({ id: `${budgetSyncId}-reconciliation-item-${i}`, statementRowIds: [statementRows[i].id], actualTransactionIds: [row.id], disposition: 'matched' })));
  const openingBalanceMinor = demo.transactions.checking.filter((row) => !row.is_child && row.date < `${lastMonth.key}-01`).reduce((sum, row) => sum + row.amount, 0);
  const net = rows.reduce((sum, row) => sum + row.amount, 0);
  updateReconciliationSession(db, session.id, { status: 'needs_review', statementFormat: 'delimited', statementStart: `${lastMonth.key}-01`, statementEnd: `${lastMonth.key}-28`, totals: { rowCount: rows.length, net, openingBalanceMinor, closingBalanceMinor: openingBalanceMinor + net }, applyConfig: DEFAULT_APPLY_CONFIG });
  completeReconciliationWithoutWrites(db, session.id, decisionSignature(listReconciliationItems(db, session.id), DEFAULT_APPLY_CONFIG));
  const currentRows = demo.transactions.checking.filter((row) => row.date.startsWith(current.key) && !row.is_child);
  const pendingRows = currentRows.filter((row) => !row.reconciled && !row.is_parent && !row.starting_balance_flag).sort((x, y) => x.date.localeCompare(y.date));
  const singletons = pendingRows.filter((row) => currentRows.filter((other) => other.date === row.date).length === 1);
  for (const [index, status] of ['needs_review', 'ready'].entries()) {
    const chosen = singletons[index] ?? pendingRows[index] ?? pendingRows[0];
    if (!chosen) throw new Error('No unreconciled checking transaction for the demo');
    const selected = [chosen];
    const pending = createReconciliationSession(db, { budgetSyncId, accountId: a.checking, accountName: 'Household Checking', statementName: `Checking ${current.key} ${status}.csv` });
    const statement = selected.map((row, i) => ({ id: `${budgetSyncId}-${status}-row-${i}`, sourceRowNumber: i + 2, postedDate: row.date, amount: row.amount, importedPayee: row.imported_payee || 'Household transaction', fingerprint: `demo-${status}-${row.id}`, raw: { date: row.date, amount: row.amount } }));
    replaceStatementRows(db, pending.id, statement);
    const row = selected[0];
    const snapshot = { id: row.id, accountId: a.checking, date: row.date, amount: row.amount, payeeId: row.payeeId ?? null, payeeName: row.payeeName ?? null, importedPayee: row.imported_payee ?? null, categoryId: row.category ?? null, categoryName: row.categoryName ?? null, notes: row.notes ?? null, cleared: Boolean(row.cleared), reconciled: Boolean(row.reconciled), importedId: row.imported_id ?? null, transferId: row.transfer_id ?? null, scheduleId: row.schedule ?? null, isParent: false, isChild: false, parentId: null, splitLines: [] };
    const items = [{ id: `${budgetSyncId}-${status}-item`, statementRowIds: [statement[0].id], actualTransactionIds: status === 'ready' ? [row.id] : [], disposition: status === 'ready' ? 'matched' : 'unresolved', ...(status === 'ready' ? { actualSnapshot: snapshot, guards: { protectedReconciled: false, splitParent: false, transfer: row.transfer_id ? 'yes' : 'no' } } : {}) }];
    // Other transactions on the same day are outside this tiny statement;
    // retain them so reopening the session does not introduce unresolved rows.
    if (status === 'ready') for (const other of currentRows.filter((entry) => entry.date === row.date && entry.id !== row.id)) items.push({ id: `${budgetSyncId}-${status}-keep-${other.id}`, statementRowIds: [], actualTransactionIds: [other.id], disposition: 'keep' });
    replaceReconciliationItems(db, pending.id, items);
    updateReconciliationSession(db, pending.id, { status, statementFormat: 'delimited', statementStart: selected[0].date, statementEnd: selected.at(-1).date, totals: { rowCount: selected.length, net: selected.reduce((sum, row) => sum + row.amount, 0) }, applyConfig: status === 'ready' ? { ...DEFAULT_APPLY_CONFIG, clearedTarget: 'reconciled' } : DEFAULT_APPLY_CONFIG });
  }

}
insertFxRate(db, { baseCurrency: 'USD', quoteCurrency: 'AUD', requestedDate: manifest[0].months.at(-1).key + '-01', effectiveDate: manifest[0].months.at(-1).key + '-01', rate: '1.5000', source: 'manual', notes: 'Illustrative demo rate, not a live quote' });
const destination = createBackupDestination(db, { name: 'Demo backup folder', kind: 'local', config: { version: 1, data: { path: '/data/backups' } } });
const policy = createBackupPolicy(db, { name: 'Monthly demo Bench backup', contents: 'app-db', sourceRef: { version: 1, data: {} }, destinationIds: [destination.id], scheduleKind: 'cron', cronExpression: '0 2 1 * *', timezone: 'UTC', scrubEnabled: false, verificationLevel: 'data', encryption: 'none' });
reconcileBackupAutomations(db, [policy]);
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log(`Generated demo Bench metadata for ${manifest.length} budgets`);
