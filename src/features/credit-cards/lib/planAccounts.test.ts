import { planLedger, totalOwed, trackedDebtPoints } from "./derive/planAccounts";
import { activityKind } from "./derive/types";
import { planProgress, planStatus } from "./plans";
import { sumMinor } from "./statements";
import { row, setup, snapshot, transfer } from "./fixtures/testKit";
import type { ActivityRow } from "./activity";
import type { RepaymentPlanInput } from "./models";

const PLAN_ACCOUNT = "plan-laptop";
const TODAY = "2026-06-15";

/** A 30,000.00 purchase converted into a plan, billed back 5,000.00 a month (realistic legs). */
function laptop(options: { tag?: string; conversionPeerDate?: string; notes?: string } = {}) {
  const purchase = row({ id: "laptop", date: "2026-03-01", amount: -3000000, payeeName: "Laptop store", categoryId: "tech" });
  const conversion = transfer("conversion", "2026-03-05", 3000000, PLAN_ACCOUNT, {
    peerDate: options.conversionPeerDate, notes: options.tag ? `${options.tag} conversion` : null,
  });
  const billed = [1, 2, 3].map((month) => transfer(`bill-${month}`, `2026-0${month + 3}-03`, -500000, PLAN_ACCOUNT, {
    notes: options.notes ?? (options.tag ? `${options.tag} instalment` : null),
  }));
  return { purchase, conversion, billed };
}

function context(plan: Partial<RepaymentPlanInput>, legs: { card: ActivityRow; peer: ActivityRow }[], cardRows: ActivityRow[] = [], planRows: ActivityRow[] = []) {
  const test = setup();
  const rows = [...cardRows, ...legs.map((leg) => leg.card)];
  const source = snapshot(rows, { planAccounts: { [PLAN_ACCOUNT]: { rows: [...legs.map((leg) => leg.peer), ...planRows] } }, to: TODAY });
  test.store.getState().savePlan("budget", null, source, {
    id: "plan", cardId: test.cardId, revision: 1, name: "Laptop", recordedAs: "plan-account", planAccountId: PLAN_ACCOUNT,
    originalAmountMinor: 3000000, startDate: "2026-03-01", scheduleKind: "fixed", firstDueDate: "2026-04-03",
    instalmentCount: 6, instalmentMinor: 500000, ...plan,
  }, []);
  const signedCard = sumMinor(source.rows.map((entry) => entry.amountMinor));
  const owed = () => totalOwed(test.card(), test.workspace(), source, signedCard, TODAY);
  const plan0 = () => test.workspace().plans[0];
  return { ...test, source, signedCard, owed, plan: plan0 };
}

it("owns every row in a single-plan account with no tags or links (D4, PL-9)", () => {
  const { purchase, conversion, billed } = laptop();
  const test = context({}, [conversion, ...billed], [purchase]);
  expect(test.owed()).toMatchObject({ known: true, owedMinor: 3000000, onCardMinor: 1500000, inPlanAccountsMinor: 1500000 });
  expect(planProgress(test.plan(), test.card(), test.workspace(), test.source).billedCount).toBe(3);
  expect(planStatus(test.plan(), test.card(), test.workspace(), test.source, TODAY).key).toBe("on-track");
});

it("never counts the conversion as a payment (PL-2)", () => {
  const { purchase, conversion } = laptop();
  const test = context({}, [conversion], [purchase]);
  expect(activityKind(test.source.rows[1], test.card(), test.workspace(), test.source)).toBe("instalment");
});

it("keeps Total owed when a transfer leg is dated a day later in the plan account (PL-3)", () => {
  const { purchase, conversion } = laptop({ conversionPeerDate: "2026-03-06" });
  const test = context({}, [conversion], [purchase]);
  expect(test.owed()).toMatchObject({ known: true, owedMinor: 3000000, inTransitMinor: 0 });
  const [during] = trackedDebtPoints(test.card(), test.workspace(), test.source, test.signedCard, ["2026-03-05"]);
  expect(during).toMatchObject({ valueMinor: 3000000, transitMinor: 3000000 });
});

it("counts uncleared plan-account legs in Total owed and the cleared basis once (PL-6)", () => {
  const { purchase, conversion } = laptop();
  const test = context({}, [conversion], [purchase]);
  // Actual creates the plan-account leg uncleared.
  expect(conversion.peer.cleared).toBe(false);
  expect(test.owed()).toMatchObject({ owedMinor: 3000000, confirmedOwedMinor: 3000000 });
});

it("neither hides debt nor blocks saving for a VAT or fee word in a transfer memo (PL-5)", () => {
  const { purchase, conversion, billed } = laptop({ notes: "instalment incl. VAT and fee" });
  const test = context({}, [conversion, ...billed], [purchase]);
  expect(test.owed()).toMatchObject({ known: true, owedMinor: 3000000 });
  expect(() => test.store.getState().savePlan("budget", 1, test.source, { ...test.plan(), note: "re-saved" }, [])).not.toThrow();
});

it("shows a plan saved before its conversion as waiting, with Total owed still known (PL-8)", () => {
  const test = context({}, [], [laptop().purchase]);
  expect(test.owed()).toMatchObject({ known: true, owedMinor: 3000000, inPlanAccountsMinor: 0 });
  const status = planStatus(test.plan(), test.card(), test.workspace(), test.source, TODAY);
  expect(status.key).toBe("waiting-for-conversion");
  expect(status.detail).toContain("30,000.00");
});

it("uses exact tags in a shared account, for debt and for progress alike (PL-7)", () => {
  const { purchase, conversion, billed } = laptop({ tag: "#laptop" });
  const other = transfer("phone", "2026-03-07", 1000000, PLAN_ACCOUNT, { notes: "#phone conversion" });
  const test = context({ planAccountTag: "#laptop" }, [conversion, ...billed, other], [purchase]);
  const ledger = planLedger(test.card(), test.workspace(), test.source);
  expect(ledger.rowsByPlan.get("plan")?.length).toBe(4);
  expect(ledger.unassigned.map((entry) => entry.id)).toEqual(["phone-peer"]);
  expect(planProgress(test.plan(), test.card(), test.workspace(), test.source).billedCount).toBe(3);
  // The other plan's transfer is the account's business, not this plan's: it shows as a card-level entry with no plan.
  expect(planStatus(test.plan(), test.card(), test.workspace(), test.source, TODAY).key).not.toBe("does-not-add-up");
  // Untagged money moved from this card still counts in its Total owed, as not linked yet.
  expect(test.owed()).toMatchObject({ unassignedMinor: 1000000, owedMinor: 3000000 });
});

it("starts a shared-account plan from its opening and skips legs on or before it (PL-4)", () => {
  const { purchase, conversion, billed } = laptop({ tag: "#laptop" });
  const test = context({
    planAccountTag: "#laptop", opening: { date: "2026-04-03", principalMinor: 2500000 },
  }, [conversion, ...billed], [purchase]);
  // After the opening only the May and June instalments move principal: 25,000 − 10,000.
  expect(test.owed().inPlanAccountsMinor).toBe(1500000);
  expect(test.owed().owedMinor).toBe(3000000);
});

it("counts a tagged transfer from checking into the plan account as a plan payment, keeping card debt (PL-12)", () => {
  const { purchase, conversion } = laptop();
  const direct = row({ id: "direct", date: "2026-05-20", amount: 200000, accountId: PLAN_ACCOUNT, transferId: "direct-bank" });
  const test = context({}, [conversion], [purchase], [direct]);
  expect(test.owed()).toMatchObject({ known: true, owedMinor: 2800000, onCardMinor: 0, inPlanAccountsMinor: 2800000 });
});

it("keeps Total owed visible while a plan needs checking, and hides it only without the account read (D22)", () => {
  const { purchase, conversion, billed } = laptop();
  const fee = row({ id: "plan-fee", date: "2026-04-03", amount: -2500, payeeName: "Plan fee" });
  const test = context({}, [conversion, ...billed], [purchase, fee]);
  test.store.getState().savePlan("budget", 1, test.source, test.plan(), [{
    planId: "plan", transactionId: "plan-fee", role: "cost", instalmentNumber: null, transferPairKey: null,
    identityHash: fee.identity, sourceHash: fee.fingerprint,
  }]);
  // The fee is reversed in Actual (sign change): the plan needs checking, Total owed stays.
  const reversed = snapshot([...test.source.rows.filter((entry) => entry.id !== "plan-fee"), row({ id: "plan-fee", date: "2026-04-03", amount: 2500 })], {
    planAccounts: { [PLAN_ACCOUNT]: { rows: [conversion.peer, ...billed.map((leg) => leg.peer)] } }, to: TODAY,
  });
  expect(planStatus(test.plan(), test.card(), test.workspace(), reversed, TODAY)).toMatchObject({ key: "changed", check: true });
  expect(totalOwed(test.card(), test.workspace(), reversed, test.signedCard, TODAY).known).toBe(true);
  const unread = snapshot(test.source.rows, { to: TODAY });
  expect(totalOwed(test.card(), test.workspace(), unread, test.signedCard, TODAY).known).toBe(false);
});

it("rejects an own-account plan in an account that already holds tagged plans (§12.3)", () => {
  const { purchase, conversion } = laptop({ tag: "#laptop" });
  const test = context({ planAccountTag: "#laptop" }, [conversion], [purchase]);
  expect(() => test.store.getState().savePlan("budget", null, test.source, {
    id: "other", cardId: test.cardId, revision: 1, name: "Sofa", recordedAs: "plan-account", planAccountId: PLAN_ACCOUNT,
  }, [])).toThrow("#tag");
});
