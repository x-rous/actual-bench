#!/usr/bin/env node
// Read-only smoke check for the two public demo budgets.
const base = process.argv[2] ?? 'http://127.0.0.1:17860';
const fail = (message) => { throw new Error(message); };
async function read(path, options) {
  const response = await fetch(`${base}${path}`, options);
  if (!response.ok) fail(`${path}: HTTP ${response.status}`);
  return response.json();
}
const demo = await read('/api/demo');
if (demo.budgets?.length !== 2) fail('Expected two demo budgets');
for (const budget of demo.budgets) {
  const id = budget.budgetSyncId;
  const q = `?budgetSyncId=${encodeURIComponent(id)}`;
  const { data: accounts } = await read('/api/proxy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connection: { baseUrl: demo.baseUrl, apiKey: demo.apiKey, budgetSyncId: id }, path: '/accounts' }) });
  const accountIds = new Set(accounts.map((account) => account.id));
  const { debts } = await read(`/api/assets-debt/debts${q}`);
  if (debts.length !== 4 || debts.some((debt) => debt.blocked || !accountIds.has(debt.liabilityAccountId))) fail(`${budget.label}: loans missing or unlinked`);
  const registry = await read(`/api/assets-debt/assets${q}`);
  if (registry.assets.length !== 3 || registry.metadata.length < 12 || registry.assets.some((asset) => !accountIds.has(asset.actualAccountId)) || registry.debtLinks?.length !== 3) fail(`${budget.label}: assets missing or unlinked`);
  const { workspace } = await read(`/api/credit-cards${q}`);
  if (workspace.cards.length !== 2 || workspace.cards.some((card) => !accountIds.has(card.accountId)) || workspace.statements.length < 6 || workspace.plans.length < 1 || workspace.planEntries.length < 11) fail(`${budget.label}: cards, statements or instalment plan missing`);
  const { sessions } = await read(`/api/reconciliation/sessions${q}`);
  const session = sessions.find((entry) => entry.status === 'completed' && accountIds.has(entry.accountId));
  if (!session || !sessions.some((entry) => entry.status === 'needs_review') || !sessions.some((entry) => entry.status === 'ready')) fail(`${budget.label}: reconciliation examples missing`);
  const readySession = sessions.find((entry) => entry.status === 'ready');
  const readyDetail = await read(`/api/reconciliation/sessions/${encodeURIComponent(readySession.id)}`);
  if (readyDetail.session.applyConfig?.clearedTarget !== 'reconciled' || !readyDetail.items.some((item) => item.disposition === 'matched' && item.actualSnapshot?.id === item.actualTransactionIds[0] && !item.actualSnapshot.reconciled && !item.actualSnapshot.cleared)) fail(`${budget.label}: ready reconciliation lacks a safe transaction baseline`);
  const detail = await read(`/api/reconciliation/sessions/${encodeURIComponent(session.id)}`);
  if (!detail.items.length || detail.items.some((item) => !item.actualTransactionIds.length)) fail(`${budget.label}: reconciliation has no matched transactions`);
  const query = await read('/api/proxy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    connection: { baseUrl: demo.baseUrl, apiKey: demo.apiKey, budgetSyncId: id }, path: '/run-query', method: 'POST',
    body: { ActualQLquery: { table: 'transactions', select: ['id', 'account', 'date', 'amount', 'notes', 'cleared', 'is_child'], options: { splits: 'grouped' } } },
  }) });
  const transactions = query.data;
  const byId = new Map(transactions.map((row) => [row.id, row]));
  for (const entry of registry.metadata) {
    if (byId.get(entry.actualTransactionId)?.account !== entry.actualAccountId) fail(`${budget.label}: asset transaction missing`);
  }
  for (const item of detail.items) {
    if (item.actualTransactionIds.some((txId) => byId.get(txId)?.account !== session.accountId)) fail(`${budget.label}: reconciliation transaction missing`);
  }
  for (const asset of registry.assets) {
    const book = registry.metadata.filter((entry) => entry.assetId === asset.id).reduce((sum, entry) => sum + byId.get(entry.actualTransactionId).amount, 0);
    const actual = transactions.filter((row) => row.account === asset.actualAccountId && !row.is_child).reduce((sum, row) => sum + row.amount, 0);
    if (book !== actual) fail(`${budget.label}: asset book does not match Actual`);
  }
  for (const debt of debts) {
    const { effective } = await read(`/api/assets-debt/debts/${encodeURIComponent(debt.id)}/anchors`);
    if (!effective) fail(`${budget.label}: loan anchor missing`);
    const actual = -transactions.filter((row) => row.account === debt.liabilityAccountId && !row.is_child && row.date <= effective.anchorDate).reduce((sum, row) => sum + row.amount, 0);
    if (!effective || effective.principalMinor !== actual) fail(`${budget.label}: loan anchor does not match Actual`);
  }
  const card = workspace.cards.find((entry) => accounts.find((account) => account.id === entry.accountId)?.name === 'Everyday Rewards Card');
  const installmentCard = workspace.cards.find((entry) => entry.id !== card?.id);
  if (!card || !installmentCard) fail(`${budget.label}: named cards are missing`);
  for (const statement of workspace.statements) {
    const cardForStatement = workspace.cards.find((entry) => entry.id === statement.cardId);
    if (!cardForStatement) fail(`${budget.label}: statement has no card`);
    const balance = -transactions.filter((row) => row.account === cardForStatement.accountId && !row.is_child && row.date <= statement.closingDate).reduce((sum, row) => sum + row.amount, 0);
    if (balance !== statement.balanceMinor) fail(`${budget.label}: statement balance does not match Actual`);
  }
  const statements = workspace.statements.filter((statement) => statement.cardId === card.id).sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  const paymentFor = (statement) => transactions.filter((row) => row.account === card.accountId && row.notes === 'Monthly credit card payment' && row.cleared && row.date > statement.closingDate && row.date <= statement.dueDate).reduce((sum, row) => sum + row.amount, 0);
  if (statements.length < 3 || paymentFor(statements.at(-2)) < statements.at(-2).balanceMinor || paymentFor(statements.at(-1)) >= statements.at(-1).balanceMinor) fail(`${budget.label}: paid and outstanding card examples are missing`);
  if (paymentFor(statements[0]) >= statements[0].minimumDueMinor) fail(`${budget.label}: missed minimum payment missing`);
  const paidInstallments = workspace.statements.filter((statement) => statement.cardId === installmentCard.id && statement.dueDate < new Date().toISOString().slice(0, 10));
  for (const statement of paidInstallments) {
    const paid = transactions.filter((row) => row.account === installmentCard.accountId && row.notes === 'Installment card full statement payment' && row.cleared && row.date > statement.closingDate && row.date <= statement.dueDate).reduce((sum, row) => sum + row.amount, 0);
    if (paid < statement.balanceMinor) fail(`${budget.label}: installment card statement not fully paid`);
  }

  if (!transactions.some((row) => row.account === card.accountId && row.notes?.includes('Credit card interest'))) fail(`${budget.label}: card interest missing`);
  const rental = registry.assets.find((asset) => asset.name === 'Investment Property');
  const rentalFlows = (registry.cashflows ?? []).filter((entry) => entry.assetId === rental?.id).map((entry) => byId.get(entry.actualTransactionId));
  if (!rental || !rentalFlows.some((row) => row?.amount > 0) || !rentalFlows.some((row) => row?.amount < 0)) fail(`${budget.label}: rental cashflow missing`);
  const home = registry.assets.find((asset) => asset.name === 'Family Home');
  const homeRows = registry.metadata.filter((entry) => entry.assetId === home?.id).map((entry) => byId.get(entry.actualTransactionId)).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  if (homeRows.length < 7 || Number(homeRows.at(-1).date.slice(0, 4)) - Number(homeRows[0].date.slice(0, 4)) < 6) fail(`${budget.label}: home valuation history missing`);
  const { accountClasses } = await read(`/api/account-classes${q}`);
  if (accountClasses.length < 13) fail(`${budget.label}: account classifications missing`);
  console.log(`demo metadata: OK ${budget.label} — ${debts.length} loans, ${workspace.statements.length} statements, ${registry.assets.length} assets, ${detail.items.length} reconciled rows`);
}

const { pairs } = await read('/api/fx/pairs');
if (!pairs.some((pair) => pair.base === 'USD' && pair.quote === 'AUD')) fail('USD/AUD rate missing');
const { destinations } = await read('/api/backups/destinations');
const { policies } = await read('/api/backups/policies');
const { automations } = await read('/api/automations');
const monthly = policies.find((policy) => policy.name === 'Monthly demo Bench backup' && policy.cronExpression === '0 2 1 * *');
if (!monthly || !destinations.some((destination) => monthly.destinationIds.includes(destination.id)) || !automations.some((automation) => automation.config?.data?.policyId === monthly.id && automation.enabled && automation.lastRun?.status === 'succeeded')) fail('Monthly demo backup setup or initial verified run missing');
console.log('demo metadata: OK USD/AUD rate and monthly backup automation');
