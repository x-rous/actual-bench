import { normalizeActivity } from "./activity";
import { evidenceHash } from "./evidence";
import { deriveCardView } from "./derive/cardView";
import { statementBreakdown } from "./derive/breakdown";
import { twoYearFixture } from "./fixtures/twoYear.fixture";
import { suggestPlanLink } from "./plans";
import { statementReview } from "./statements";
import { trackedDebtPoints } from "./derive/planAccounts";

/**
 * Performance budgets on the two-year fixture (3 cards × ~1,500 rows). Budgets are set with
 * headroom for slow CI machines; the browser target is under 100 ms per interaction.
 */
const time = (run: () => void) => {
  const start = performance.now();
  run();
  const ms = performance.now() - start;
  if (process.env.CC_PERF_LOG) console.log(`${expect.getState().currentTestName}: ${ms.toFixed(1)} ms`);
  return ms;
};

/** The BigInt 64-bit FNV-1a that `cc-v2` replaced; timed in the same run so load affects both equally. */
function bigIntFnv(value: unknown) {
  const text = JSON.stringify(value);
  let hash = BigInt("14695981039346656037");
  for (let index = 0; index < text.length; index++) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(index))) * BigInt("1099511628211"));
  }
  return hash.toString(16);
}

it("hashes faster than the BigInt digest it replaced and normalises 5,000 rows within budget", () => {
  const { sources } = twoYearFixture();
  const all = sources.flat();
  const rows = [...all, ...all.map((row) => ({ ...row, id: `${row.id}-copy` }))].slice(0, 5000);
  expect(rows).toHaveLength(5000);
  const inputs = rows.map((row) => [row.id, row.accountId, row.date, row.amount, true, null, null]);
  inputs.slice(0, 500).forEach((input) => { evidenceHash(input); bigIntFnv(input); });
  // Best of five interleaved runs each: one GC pause or JIT warm-up on a shared CI runner can't decide it.
  let current = Infinity;
  let replaced = Infinity;
  for (let run = 0; run < 5; run++) {
    current = Math.min(current, time(() => inputs.forEach((input) => evidenceHash(input))));
    replaced = Math.min(replaced, time(() => inputs.forEach((input) => bigIntFnv(input))));
  }
  // Locally about 2x faster; shared CI runners narrow the gap (0.83x seen), so the guard is "never slower".
  expect(current).toBeLessThan(replaced);
  // Jest runs this far slower than a browser (~7 ms per 9,000 hashes in plain Node); budget is coarse.
  normalizeActivity(rows.slice(0, 200));
  expect(time(() => normalizeActivity(rows))).toBeLessThan(1000);
});

it("gives a transaction the same hashes whichever transport shape it was read through", () => {
  const { sources } = twoYearFixture();
  const direct = sources[0][0];
  // HTTP reads used for structural checks resolve no display names.
  const http = { ...direct, payeeId: "payee-1", payeeName: null, categoryName: null, importedId: "bank-1" };
  const [a] = normalizeActivity([direct]).rows;
  const [b] = normalizeActivity([http]).rows;
  expect(a.fingerprint).toMatch(/^cc-v2:[0-9a-f]{16}$/);
  expect(b.fingerprint).toBe(a.fingerprint);
  expect(b.evidenceFingerprint).toBe(a.evidenceFingerprint);
  expect(b.identity).toBe(a.identity);
});

it("suggests plan links for a card's rows without rebuilding the schedule per row", () => {
  const { cards, snapshots, workspace } = twoYearFixture();
  const plan = workspace.plans.find((entry) => entry.id === "plan-apr")!;
  const rows = snapshots[0].rows.slice(0, 1500);
  const elapsed = time(() => {
    for (const row of rows) suggestPlanLink(row, plan, cards[0], workspace, snapshots[0]);
  });
  // One schedule build plus indexed lookups (~30 ms alone); ~33 s when the schedule was rebuilt per row.
  expect(elapsed).toBeLessThan(1000);
});

it("returns the same card view for unchanged data, so re-renders do no derivation work", () => {
  const { cards, snapshots, workspace, today } = twoYearFixture();
  const input = { card: cards[0], workspace, snapshot: snapshots[0], rawSignedBalanceMinor: -150000, today };
  const first = deriveCardView(input);
  expect(first.rows).toHaveLength(first.statements.length);
  const again = time(() => expect(deriveCardView({ ...input })).toBe(first));
  expect(again).toBeLessThan(50);
  expect(deriveCardView({ ...input, rawSignedBalanceMinor: -150001 })).not.toBe(first);
});

it("derives one consistent breakdown per statement", () => {
  const { cards, snapshots, workspace } = twoYearFixture();
  const statement = workspace.statements.find((entry) => entry.cardId === cards[0].id && entry.closingDate === "2026-09-10")!;
  const breakdown = statementBreakdown(cards[0], statement, workspace, snapshots[0]);
  expect(statementBreakdown(cards[0], statement, workspace, snapshots[0])).toBe(breakdown);
  if (breakdown.known && breakdown.calculatedMinor !== null && breakdown.openingMinor !== null) {
    expect(breakdown.calculatedMinor).toBe(breakdown.openingMinor - breakdown.paymentsAndCreditsMinor!
      + breakdown.chargesMinor! + breakdown.interestAndFeesMinor!);
  }
});

it("reviews 24 statements from a date index, and a repeat with unchanged inputs is cached (6a)", () => {
  const { cards, snapshots, workspace } = twoYearFixture();
  const statements = workspace.statements.filter((entry) => entry.cardId === cards[0].id);
  const first = time(() => statements.forEach((statement) => statementReview(statement, workspace, snapshots[0])));
  expect(first).toBeLessThan(1500);
  const again = time(() => statements.forEach((statement) => statementReview(statement, workspace, snapshots[0])));
  expect(again).toBeLessThan(20);
  expect(statementReview(statements[3], workspace, snapshots[0])).toBe(statementReview(statements[3], workspace, snapshots[0]));
});

it("builds two years of daily Total owed in one pass (first review §6.4)", () => {
  const { cards, snapshots, workspace } = twoYearFixture();
  const dates = Array.from({ length: 730 }, (_, index) => new Date(Date.UTC(2024, 9, 16 + index)).toISOString().slice(0, 10));
  const elapsed = time(() => trackedDebtPoints(cards[0], workspace, snapshots[0], -150000, dates));
  expect(elapsed).toBeLessThan(500);
});
