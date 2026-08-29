#!/usr/bin/env node
/**
 * Prove every budget the demo advertises can actually be opened.
 *
 * This exists because of a failure that was invisible from the outside: the
 * backend listed both demo budgets, served the Envelope one perfectly, and
 * returned `500 Unknown error while interacting with Actual Api` for every
 * single Tracking request. Nothing in the boot log said so. It was found by a
 * visitor clicking the second budget and getting "Failed to load budget
 * management data", weeks after the deploy that caused it.
 *
 * The tell was `GET /v1/budgets`: a budget that is *listed* is not a budget
 * that *opens*. The listing merges what the server has (`state: "remote"`) with
 * what the API has locally, and the broken one appeared locally with neither a
 * `cloudFileId` nor a `groupId` - so nothing could resolve its Sync ID, and
 * every request for it failed. Listing it was never evidence of anything.
 *
 * So this asks the only question that matters, per budget: does a real data
 * request come back? It runs in two places, deliberately the same code:
 *
 *   * at container boot (`start.sh`), against 127.0.0.1, which both warms the
 *     budget cache - the first visitor stops paying for the download - and puts
 *     the answer in the Space log where a maintainer can see it;
 *   * from a workstation after a manual backend deploy, against the public URL,
 *     as the check that the deploy actually worked.
 *
 * Usage:
 *   node demo/check-budgets.mjs                       # http://127.0.0.1:7860, API_KEY from env
 *   node demo/check-budgets.mjs --url <base> --key <k>
 *
 * Exit code is 0 when every budget answered, 1 when any did not - so it can gate
 * a deploy - except with `--warm`, which always exits 0 because a failing check
 * must never stop the container from serving the budgets that do work.
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const warmOnly = args.includes("--warm");

const baseUrl = (flag("url", process.env.DEMO_BASE_URL ?? "http://127.0.0.1:7860")).replace(/\/+$/, "");
const apiKey = flag("key", process.env.API_KEY ?? process.env.DEMO_API_KEY ?? "");
const timeoutMs = Number(flag("timeout", "60000"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/v1${path}`, {
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 200) };
    }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: { error: error?.message ?? String(error) } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The budgets the server holds, from a `/v1/budgets` payload.
 *
 * Only the `state: "remote"` entries: those are the files the sync server
 * actually has. The local entries are the API's own cache, which is exactly what
 * goes wrong - a half-written local entry is the symptom, never the list of what
 * should work.
 */
export function remoteBudgets(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const seen = new Set();
  const budgets = [];
  for (const row of rows) {
    if (row?.state !== "remote") continue;
    const id = typeof row.groupId === "string" ? row.groupId : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    budgets.push({ syncId: id, name: typeof row.name === "string" ? row.name : id });
  }
  return budgets;
}

async function waitForApi() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status, body } = await call("/budgets");
    if (status === 200) return body;
    await sleep(2000);
  }
  return null;
}

async function main() {
  if (!apiKey) {
    console.log("demo check: no API key given (API_KEY or --key); skipping.");
    process.exit(warmOnly ? 0 : 1);
  }

  const listing = await waitForApi();
  if (!listing) {
    console.log(`demo check: FAILED - ${baseUrl} did not answer /v1/budgets within ${timeoutMs}ms`);
    process.exit(warmOnly ? 0 : 1);
  }

  const budgets = remoteBudgets(listing);
  if (budgets.length === 0) {
    console.log("demo check: FAILED - the server holds no budgets");
    process.exit(warmOnly ? 0 : 1);
  }

  const failures = [];
  for (const budget of budgets) {
    // Accounts and months together: the first proves the budget opened, the
    // second that its budget data is readable, which is the request the demo UI
    // makes on the page that reported this broken.
    const accounts = await call(`/budgets/${budget.syncId}/accounts`);
    const months = accounts.status === 200 ? await call(`/budgets/${budget.syncId}/months`) : null;
    const ok = accounts.status === 200 && months?.status === 200;

    if (ok) {
      console.log(
        `demo check: OK   ${budget.name} (${budget.syncId}) - ` +
          `${accounts.body.data?.length ?? 0} accounts, ${months.body.data?.length ?? 0} months`
      );
    } else {
      const failed = accounts.status === 200 ? months : accounts;
      const reason = failed?.body?.error ?? `HTTP ${failed?.status}`;
      console.log(`demo check: FAIL ${budget.name} (${budget.syncId}) - ${reason}`);
      failures.push(budget);
    }
  }

  if (failures.length > 0) {
    console.log(
      `demo check: ${failures.length} of ${budgets.length} budgets cannot be opened. ` +
        "The backend is serving a seed the API cannot resolve - redeploy it from demo/ " +
        "(see docs/DEMO_DEPLOYMENT.md)."
    );
    process.exit(warmOnly ? 0 : 1);
  }

  console.log(`demo check: all ${budgets.length} budgets open.`);
  process.exit(0);
}

// Importable for tests without running the check. Not top-level `await`: the
// co-located test imports this module, and a test runner parsing it as anything
// other than an ES module chokes on that before reaching the export.
if (process.argv[1] && process.argv[1].endsWith("check-budgets.mjs")) {
  main().catch((error) => {
    console.log(`demo check: FAILED - ${error?.message ?? error}`);
    process.exit(warmOnly ? 0 : 1);
  });
}
