import { statementPayments } from "./derive/payments";
import { paymentStatus } from "./derive/status";
import { statementReview } from "./statements";
import { addStatement, BANK_ACCOUNT, facts, PLAN_ACCOUNT, row, setup, snapshot, transfer } from "./fixtures/testKit";
import type { ActivityRow } from "./activity";

type Rows = ActivityRow[];

/** Previous bill P (closes 10 Feb) and bill A (closes 10 Mar, 500.00), card closing on the 10th, due the 3rd. */
function twoBills(previousBalance = 0, extra: Partial<Parameters<typeof facts>[2]> = {}) {
  const context = setup({}, [
    facts("2026-02-10", previousBalance, { periodStart: "2026-01-11", previousBalanceMinor: previousBalance }),
    facts("2026-03-10", previousBalance + 50000, { minimumDueMinor: 2500, ...extra }),
  ]);
  return { ...context, previous: context.saved[0], bill: context.saved[1] };
}

function status(context: ReturnType<typeof setup>, rows: Rows, today: string, statementId: string) {
  const source = snapshot(rows);
  const workspace = context.workspace();
  const statement = workspace.statements.find((entry) => entry.id === statementId)!;
  const payment = statementPayments(context.card(), workspace, source, today).find((entry) => entry.statementId === statementId);
  return { payment, status: paymentStatus(statement, payment, today), source };
}

const purchase = row({ id: "laptop", date: "2026-03-01", amount: -50000, categoryId: "shopping" });

it("pays bill A with a closing-day payment excluded from A (CA-1)", () => {
  const context = twoBills();
  const pay = transfer("pay", "2026-03-10", 50000, BANK_ACCOUNT);
  const rows = [purchase, pay.card];
  const source = snapshot(rows);
  // The bank posted the payment after close, so the user takes it off bill A.
  context.store.getState().saveReview("budget", context.bill.id, 1, source, [
    { transactionId: "laptop", decision: "included", bankPostingDate: null, note: null },
    { transactionId: "pay", decision: "excluded", bankPostingDate: null, note: null },
  ]);
  const bill = status(context, rows, "2026-04-04", context.bill.id);
  expect(bill.payment).toMatchObject({ paidMinor: 50000, leftToPayMinor: 0 });
  expect(bill.status.key).toBe("paid");
  const previous = status(context, rows, "2026-04-04", context.previous.id);
  expect(previous.payment?.paidMinor).toBe(0);
  expect(context.workspace().statements.find((entry) => entry.id === context.bill.id)?.reviewState).toBe("verified");
});

it("pays bill A with a payment made two days before close that the bank posted after it", () => {
  const context = twoBills(30000);
  const pay = transfer("pay", "2026-03-08", 50000, BANK_ACCOUNT);
  const rows = [purchase, pay.card];
  context.store.getState().saveReview("budget", context.bill.id, 1, snapshot(rows), [
    { transactionId: "pay", decision: "excluded", bankPostingDate: "2026-03-11", note: null },
  ]);
  const bill = status(context, rows, "2026-04-04", context.bill.id);
  expect(bill.payment).toMatchObject({ paidMinor: 50000, leftToPayMinor: 30000 });
  expect(status(context, rows, "2026-04-04", context.previous.id).payment?.paidMinor).toBe(0);
});

it("lets one payment pay two bills when the first bill's due date is after the next close (CA-11)", () => {
  const context = setup({}, [
    facts("2026-03-10", 10000, { periodStart: "2026-02-11", dueDate: "2026-04-15", previousBalanceMinor: 0 }),
    facts("2026-04-10", 30000, { minimumDueMinor: 2500 }),
  ]);
  const [first, second] = context.saved;
  const pay = transfer("pay", "2026-04-12", 30000, BANK_ACCOUNT);
  const rows = [pay.card];
  expect(status(context, rows, "2026-05-04", first.id).status.key).toBe("paid");
  expect(status(context, rows, "2026-05-04", second.id).status.key).toBe("paid");
});

it("nets a returned payment against the bill it paid (D13)", () => {
  const context = twoBills();
  const pay = transfer("pay", "2026-03-20", 50000, BANK_ACCOUNT);
  const returned = row({ id: "returned", date: "2026-03-25", amount: -50000, payeeName: "RETURNED PAYMENT" });
  const result = status(context, [purchase, pay.card, returned], "2026-04-04", context.bill.id);
  expect(result.payment?.paidMinor).toBe(0);
  expect(result.status.key).toBe("overdue");
});

it("counts a non-transfer \"PAYMENT THANK YOU\" credit as a payment (D12)", () => {
  const context = twoBills();
  const thanks = row({ id: "thanks", date: "2026-03-20", amount: 50000, payeeName: "PAYMENT THANK YOU" });
  expect(status(context, [purchase, thanks], "2026-04-04", context.bill.id).status.key).toBe("paid");
});

it("shows a pending payment made on the due date as pending and on time, never overdue (CA-7)", () => {
  const context = twoBills();
  const pay = transfer("pay", "2026-04-03", 50000, BANK_ACCOUNT, { cleared: false });
  const result = status(context, [purchase, pay.card], "2026-04-04", context.bill.id);
  expect(result.status).toMatchObject({ key: "pending", overdue: false, line: "Paid on time · clearing" });
  expect(result.payment).toMatchObject({ paidMinor: 0, pendingMinor: 50000, unpaidAtDueMinor: null });
});

it("labels a bill covered by payments plus a refund after close as covered with credits (D14)", () => {
  const context = twoBills();
  const refund = row({ id: "refund", date: "2026-03-15", amount: 20000, payeeName: "Shop", categoryId: "shopping" });
  const pay = transfer("pay", "2026-03-25", 30000, BANK_ACCOUNT);
  const result = status(context, [purchase, refund, pay.card], "2026-04-04", context.bill.id);
  expect(result.payment).toMatchObject({ paidMinor: 30000, creditsMinor: 20000, leftToPayMinor: 20000, unpaidAtDueMinor: 0 });
  expect(result.status.key).toBe("covered-with-credits");
});

it("keeps Paid, Left to pay and the badge on one allocation, with the amount due capped by the balance", () => {
  const context = twoBills(0, { amountDueMinor: 20000 });
  const pay = transfer("pay", "2026-03-25", 20000, BANK_ACCOUNT);
  const result = status(context, [purchase, pay.card], "2026-04-04", context.bill.id);
  expect(result.payment).toMatchObject({ amountDueMinor: 20000, paidMinor: 20000, leftToPayMinor: 0, unpaidAtDueMinor: 30000 });
  expect(result.status.key).toBe("paid");
  expect(() => addStatement(context.store, "budget", context.cardId, facts("2026-04-10", 1000, { amountDueMinor: 999999 }))).toThrow("Amount due");
});

it("never treats a transfer from a plan account as a payment, even before any plan exists (PL-2)", () => {
  const context = twoBills();
  context.store.getState().setPlanAccounts("budget", ["plan-laptop"]);
  const conversion = transfer("conversion", "2026-03-20", 3000000, "plan-laptop");
  const rows = [purchase, conversion.card];
  const source = snapshot(rows, { planAccounts: { "plan-laptop": { rows: [conversion.peer] } } });
  const workspace = context.workspace();
  const payment = statementPayments(context.card(), workspace, source, "2026-04-04").find((entry) => entry.statementId === context.bill.id);
  expect(payment?.paidMinor).toBe(0);
  expect(statementReview(workspace.statements[1], workspace, source).rows.map((entry) => entry.id)).toContain("laptop");
});

describe("plan conversions settle the bill they convert", () => {
  // A 10,513.00 school fee billed on 01 Sep, converted into a plan on 11 Sep, then 2,219.20 paid on the due date.
  async function converted(planStart: string) {
    const context = setup({}, [
      facts("2026-09-01", 1093195, { periodStart: "2026-08-02", dueDate: "2026-09-26", minimumDueMinor: 54660, previousBalanceMinor: 0 }),
    ]);
    const fee = row({ id: "school", date: "2026-09-01", amount: -1051300, categoryId: "school" });
    const membership = row({ id: "membership", date: "2026-09-01", amount: -41895, categoryId: "fees" });
    const conversion = transfer("conversion", "2026-09-11", 1051300, PLAN_ACCOUNT);
    const pay = transfer("pay", "2026-09-26", 221920, BANK_ACCOUNT);
    const rows = [fee, membership, conversion.card, pay.card];
    const read = snapshot(rows, { from: "2026-08-01", to: "2026-10-16", planAccounts: { [PLAN_ACCOUNT]: { rows: [conversion.peer] } } });
    await context.store.getState().savePlan("budget", null, read, {
      id: "plan", cardId: context.cardId, revision: 1, name: "School", recordedAs: "plan-account", planAccountId: PLAN_ACCOUNT,
      originalAmountMinor: 1051300, startDate: planStart,
    }, []);
    const workspace = context.workspace();
    const statement = workspace.statements[0];
    const payment = statementPayments(context.card(), workspace, read, "2026-10-16").find((entry) => entry.statementId === statement.id)!;
    return { payment, status: paymentStatus(statement, payment, "2026-10-16") };
  }

  it("counts the conversion toward Left to pay but never toward Paid or the minimum, and says the bill was settled with a plan", async () => {
    const { payment, status: bill } = await converted("2026-09-01");
    expect(payment).toMatchObject({
      paidMinor: 221920, convertedMinor: 1051300, leftToPayMinor: 0, minimumLeftMinor: 0, paidDate: "2026-09-26",
      unpaidAtDueMinor: 0,
    });
    expect(payment.conversions.map((entry) => entry.row.id)).toEqual(["conversion"]);
    expect(payment.rows.map((entry) => entry.row.id)).toEqual(["pay"]);
    // Settled, not paid in full: Paid stays the real payments and the badge says why.
    expect(bill).toMatchObject({ key: "settled-with-plan", label: "Settled with a plan", tone: "success", line: "10,513.00 moved to a plan", paid: true });
  });

  it("ignores a conversion whose plan started after the close", async () => {
    const { payment } = await converted("2026-09-05");
    expect(payment).toMatchObject({ convertedMinor: 0, leftToPayMinor: 871275 });
  });
});
