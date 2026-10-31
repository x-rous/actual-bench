#!/usr/bin/env node
// Take a real initial demo backup so the monthly scheduler has a prior run.
const base = 'http://127.0.0.1:7860';
async function request(path, options) {
  const response = await fetch(`${base}${path}`, options);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
const { automations } = await request('/api/automations');
const automation = automations.find((entry) => entry.name === 'Monthly demo Bench backup' && entry.type === 'backup' && entry.enabled);
if (!automation) throw new Error('The monthly demo backup automation is missing');
const { runId } = await request(`/api/automations/${encodeURIComponent(automation.id)}/run`, { method: 'POST' });
for (let attempt = 0; attempt < 120; attempt++) {
  const { run } = await request(`/api/automations/runs/${encodeURIComponent(runId)}`);
  if (run.status === 'succeeded') {
    console.log('Demo initial backup completed and verified');
    process.exit(0);
  }
  if (run.status !== 'running') throw new Error(`Demo initial backup ended: ${run.status}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
throw new Error('Demo initial backup timed out');
