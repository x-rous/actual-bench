import { keywordType } from "./recognition";
import { transactionType, activityKind } from "./derive/types";
import { observedChargeTotals } from "./history";
import { BANK_ACCOUNT, row, setup, snapshot, transfer } from "./fixtures/testKit";
import type { TransactionType } from "./models";

/** The 21 ordinary merchants the second review found misclassified (R1), plus more of the same kind. */
const ORDINARY_MERCHANTS = [
  "NON PROFIT SOCIETY", "INTEREST BOOKS LTD", "MUSEUM ENTRY FEE", "AMAZON AU GST", "EMI MUSIC STORE", "PLAN IT TRAVEL",
  "BCP PHARMACY", "PROFIT FITNESS GYM", "VAT 69 LIQUOR", "FEE FI FO TOYS", "THE INTEREST CAFE", "TAX FREE SHOP",
  "IPP DESIGN STUDIO", "FIP COFFEE", "EPP ELECTRONICS", "INSTALLMENT FURNITURE CO", "PARCELA BAR", "FINANCE TODAY MAG",
  "SERVICE STATION 24", "ANNUAL GENERAL MEETING", "LATE NIGHT PIZZA", "REFUND CAFE", "PAYMENT GATEWAY SHOP",
  "THANK YOU FLORIST", "CASHBACK GARDENS", "GOODWILL STORE", "CHARGEBACK BAR",
];

/** Issuer phrases that must be suggested, with the sign they are posted with. */
const ISSUER_PHRASES: [string, number, TransactionType][] = [
  ["INTEREST CHARGE", -800, "interest"],
  ["PURCHASE INTEREST CHARGED", -800, "interest"],
  ["CASH INTEREST", -800, "interest"],
  ["INTEREST", -800, "interest"],
  ["INTEREST CHARGES", -800, "interest"],
  ["INT CHG", -800, "interest"],
  ["INTEREST CHG 0912", -800, "interest"],
  ["FINANCE CHARGE", -800, "interest"],
  ["FINANCE CHARGES OCT", -800, "interest"],
  ["PROFIT CHARGE", -800, "interest"],
  ["INTEREST CHARGE REVERSAL", 800, "interest"],
  ["ANNUAL FEE", -9900, "fee"],
  ["LATE PAYMENT FEE", -2500, "fee"],
  ["LATE FEE", -2500, "fee"],
  ["OVERLIMIT FEE", -2500, "fee"],
  ["OVER LIMIT FEE", -2500, "fee"],
  ["FOREIGN TRANSACTION FEE", -300, "fee"],
  ["CASH ADVANCE FEE", -300, "fee"],
  ["RETURNED PAYMENT FEE", -2500, "fee"],
  ["SERVICE CHARGE", -500, "fee"],
  ["VAT ON FEES", -75, "fee"],
  ["GST ON INTEREST", -40, "fee"],
  ["TAX ON CHARGES", -40, "fee"],
  ["ANNUAL FEE REFUND", 9900, "fee"],
  ["EMI 3/12 LAPTOP", -10500, "instalment"],
  ["EPP 03 OF 12", -10500, "instalment"],
  ["IPP 1/6", -10500, "instalment"],
  ["INSTALMENT 2 OF 6", -10500, "instalment"],
  ["INSTALLMENT 4/10", -10500, "instalment"],
  ["PARCELA 02/10", -10500, "instalment"],
  ["EPP CONVERSION", 120000, "instalment"],
  ["PAYMENT THANK YOU", 50000, "payment"],
  ["AUTOPAY PAYMENT", 50000, "payment"],
  ["DIRECT DEBIT RECEIVED", 50000, "payment"],
  ["RETURNED PAYMENT", -50000, "payment"],
  ["PAYMENT REVERSAL", -50000, "payment"],
  ["DISHONOURED PAYMENT", -50000, "payment"],
  ["CASHBACK", 1200, "cashback"],
  ["REWARDS CREDIT", 1200, "cashback"],
  ["POINTS REDEMPTION", 1200, "cashback"],
  ["ATM CASH WITHDRAWAL", -20000, "cash-advance"],
  ["CASH ADVANCE", -20000, "cash-advance"],
  ["BALANCE TRANSFER", -300000, "balance-transfer"],
  ["DISPUTE CREDIT", 4500, "adjustment"],
  ["PROVISIONAL CREDIT", 4500, "adjustment"],
  ["GOODWILL CREDIT", 1000, "adjustment"],
  ["MERCHANT REFUND", 4500, "refund"],
  ["CREDIT NOTE 123", 4500, "refund"],
];

it("never matches ordinary merchant names (0 of the second review's merchants misclassified)", () => {
  const charges = ORDINARY_MERCHANTS.map((payee) => [payee, keywordType(payee, -1000)?.kind ?? null]);
  expect(charges.filter(([, kind]) => kind !== null)).toEqual([]);
});

it.each(ISSUER_PHRASES)("suggests %s (%d) as %s", (payee, amount, kind) => {
  expect(keywordType(payee, amount)?.kind).toBe(kind);
});

it("keeps the keyword table at about 100 checked strings", () => {
  expect(ORDINARY_MERCHANTS.length + ISSUER_PHRASES.length).toBeGreaterThanOrEqual(75);
});

it("follows the evidence ladder: structure, your type, mapped categories, any category, then payee keywords", () => {
  const { workspace, card } = setup({ interestCategoryId: "interest", feeCategoryId: "fees", cashbackCategoryId: "rewards" });
  const pay = transfer("pay", "2026-03-20", 50000, BANK_ACCOUNT);
  const rows = [
    row({ id: "books", date: "2026-03-01", amount: -2500, payeeName: "INTEREST BOOKS LTD", categoryId: "books", categoryName: "Books" }),
    row({ id: "noted", date: "2026-03-02", amount: -2500, payeeName: "GROCER", notes: "annual fee reimbursed" }),
    row({ id: "mapped", date: "2026-03-10", amount: -800, payeeName: "Shop", categoryId: "interest" }),
    row({ id: "issuer", date: "2026-03-10", amount: -800, payeeName: "INT CHG" }),
    row({ id: "fee", date: "2026-03-10", amount: -500, payeeName: "Shop", categoryId: "fees" }),
    row({ id: "reward", date: "2026-03-10", amount: 500, payeeName: "Shop", categoryId: "rewards" }),
    pay.card,
    pay.peer,
  ];
  const source = snapshot(rows);
  const type = (id: string) => transactionType(source.rows.find((entry) => entry.id === id)!, card(), workspace(), source);
  expect(type("books")).toMatchObject({ kind: "purchase", source: "category" });
  expect(type("noted")).toMatchObject({ kind: "purchase", source: "suggested" });
  expect(type("mapped")).toMatchObject({ kind: "interest", source: "category", counted: true });
  expect(type("issuer")).toMatchObject({ kind: "interest", source: "suggested", counted: false });
  expect(type("fee")).toMatchObject({ kind: "fee", source: "category" });
  expect(type("reward")).toMatchObject({ kind: "cashback", source: "category" });
  expect(type("pay")).toMatchObject({ kind: "payment", source: "structure" });
});

it("reads keywords from Actual's imported payee, never the notes", () => {
  const { workspace, card } = setup();
  const imported = row({ id: "imported", date: "2026-03-10", amount: -800, payeeName: "Visa interest", importedPayee: "FINANCE CHARGE" });
  const notes = row({ id: "notes", date: "2026-03-10", amount: -800, payeeName: "Cafe", notes: "INTEREST CHARGE" });
  const source = snapshot([imported, notes]);
  expect(activityKind(source.rows[0], card(), workspace(), source)).toBe("interest");
  expect(activityKind(source.rows[1], card(), workspace(), source)).toBe("purchase");
});

it("excludes suggested interest from cost totals until accepted, and says how many (A5)", () => {
  const { store, workspace, card, cardId } = setup({ interestCategoryId: "interest" });
  const source = snapshot([
    row({ id: "mapped", date: "2026-03-10", amount: -800, categoryId: "interest" }),
    row({ id: "guess", date: "2026-03-10", amount: -16500, payeeName: "INTEREST CHARGE" }),
  ]);
  const before = observedChargeTotals(card(), workspace(), source, "2026-12-31", "interest");
  expect(before).toMatchObject({ totalMinor: 800, suggestedCount: 1 });
  store.getState().setTypes("budget", cardId, source, [{ transactionId: "guess", kind: "interest" }]);
  const after = observedChargeTotals(card(), workspace(), source, "2026-12-31", "interest");
  expect(after).toMatchObject({ totalMinor: 17300, suggestedCount: 0 });
  expect(transactionType(source.rows[1], card(), workspace(), source)).toMatchObject({ source: "user", counted: true });
});

it("lets you mark a non-transfer credit as a payment, and reverts a correction with Use suggestion (D12, FR-3)", () => {
  const { store, workspace, card, cardId } = setup();
  const source = snapshot([row({ id: "cash", date: "2026-03-20", amount: 50000, payeeName: "BRANCH DEPOSIT" })]);
  const kind = () => activityKind(source.rows[0], card(), workspace(), source);
  expect(kind()).toBe("refund");
  store.getState().setTypes("budget", cardId, source, [{ transactionId: "cash", kind: "payment" }]);
  expect(kind()).toBe("payment");
  store.getState().setTypes("budget", cardId, source, [{ transactionId: "cash", kind: null }]);
  expect(kind()).toBe("refund");
  expect(workspace().typeCorrections).toEqual([]);
});

it("rejects credit-only types on charges and types on plan-account transfers", () => {
  const { store, cardId } = setup();
  const plan = transfer("conv", "2026-03-15", 30000, "plan-laptop");
  const source = snapshot([row({ id: "spend", date: "2026-03-01", amount: -1000 }), plan.card], {
    planAccounts: { "plan-laptop": { rows: [plan.peer] } },
  });
  store.getState().setPlanAccounts("budget", ["plan-laptop"]);
  expect(() => store.getState().setTypes("budget", cardId, source, [{ transactionId: "spend", kind: "refund" }])).toThrow("credits");
  expect(() => store.getState().setTypes("budget", cardId, source, [{ transactionId: "conv", kind: "payment" }])).toThrow("plan");
});
