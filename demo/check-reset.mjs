#!/usr/bin/env node
// CI-only: write and find a marker in the disposable container's Actual budget.
const [action, marker] = process.argv.slice(2);
if (!['write', 'verify'].includes(action) || !/^demo-reset-[0-9]+-[0-9]+$/.test(marker ?? '')) {
  throw new Error('Expected write|verify and a demo reset marker');
}
const base = 'http://127.0.0.1:17860';
const budgetSyncId = '7d243b3e-d2dc-4863-be75-b1fd85b77c2b';
async function request(path, options) {
  const response = await fetch(`${base}${path}`, options);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const demo = await request('/api/demo');
if (demo.baseUrl !== 'http://127.0.0.1:5007' || demo.apiKey !== 'ci-demo-key' || !demo.budgets.some((budget) => budget.budgetSyncId === budgetSyncId)) {
  throw new Error('Refusing to write outside the disposable CI demo');
}
const connection = { baseUrl: demo.baseUrl, apiKey: demo.apiKey, budgetSyncId };
async function proxy(path, method = 'GET', body) {
  return request('/api/proxy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connection, path, method, body }) });
}
async function matches() {
  const result = await proxy('/run-query', 'POST', { ActualQLquery: { table: 'transactions', filter: { imported_id: marker }, select: ['id', 'imported_id'] } });
  return result.data;
}
if (action === 'write') {
  if ((await matches()).length) throw new Error('Reset marker already exists');
  const accounts = await proxy('/accounts');
  const account = accounts.data.find((row) => row.name === 'Household Checking');
  if (!account) throw new Error('Demo checking account is missing');
  await proxy(`/accounts/${account.id}/transactions/batch`, 'POST', {
    transactions: [{ date: '2026-10-01', amount: -123, payee: null, category: null, notes: marker, cleared: false, imported_id: marker }],
    runTransfers: false,
  });
  if ((await matches()).length !== 1) throw new Error('Marker transaction was not written');
  console.log('demo reset: marker transaction written');
} else {
  if ((await matches()).length !== 0) throw new Error('Marker transaction survived restart');
  console.log('demo reset: marker transaction removed');
}
