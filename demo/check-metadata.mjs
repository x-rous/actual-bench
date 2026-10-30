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
  if (debts.length !== 2 || debts.some((debt) => debt.blocked || !accountIds.has(debt.liabilityAccountId))) fail(`${budget.label}: loans missing or unlinked`);
  const registry = await read(`/api/assets-debt/assets${q}`);
  if (registry.assets.length !== 2 || registry.metadata.length < 6 || registry.assets.some((asset) => !accountIds.has(asset.actualAccountId)) || registry.debtLinks?.length !== 2) fail(`${budget.label}: assets missing or unlinked`);
  const { workspace } = await read(`/api/credit-cards${q}`);
  if (workspace.cards.length !== 1 || !accountIds.has(workspace.cards[0].accountId) || workspace.statements.length < 2) fail(`${budget.label}: card or statements missing`);
  const { sessions } = await read(`/api/reconciliation/sessions${q}`);
  const session = sessions.find((entry) => entry.status === 'completed' && accountIds.has(entry.accountId));
  if (!session) fail(`${budget.label}: completed reconciliation missing`);
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
  const card = workspace.cards[0];
  for (const statement of workspace.statements) {
    const balance = -transactions.filter((row) => row.account === card.accountId && !row.is_child && row.date <= statement.closingDate).reduce((sum, row) => sum + row.amount, 0);
    if (balance !== statement.balanceMinor) fail(`${budget.label}: statement balance does not match Actual`);
  }
  const statements = [...workspace.statements].sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  const paymentFor = (statement) => transactions.filter((row) => row.account === card.accountId && row.notes === 'Monthly credit card payment' && row.cleared && row.date > statement.closingDate && row.date <= statement.dueDate).reduce((sum, row) => sum + row.amount, 0);
  if (statements.length < 3 || paymentFor(statements.at(-2)) < statements.at(-2).balanceMinor || paymentFor(statements.at(-1)) >= statements.at(-1).balanceMinor) fail(`${budget.label}: paid and outstanding card examples are missing`);
  console.log(`demo metadata: OK ${budget.label} — ${debts.length} loans, ${workspace.statements.length} statements, ${registry.assets.length} assets, ${detail.items.length} reconciled rows`);
}
