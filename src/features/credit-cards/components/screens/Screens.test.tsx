import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { cardEntry } from "../entryKit";
import { statementScenario } from "../../lib/statementScenarios.fixture";
import { addCard, BANK_ACCOUNT, BUDGET, CARD_INPUT, facts, laptopPlanScenario, resetCreditCardStore, row, setup, snapshot, transfer } from "../../lib/fixtures/testKit";
import { planEntryFor } from "../../lib/plans";
import { creditCardStore } from "../../lib/store/store";
import { sumMinor } from "../../lib/statements";
import { OverviewScreen } from "./OverviewScreen";
import { StatementsScreen } from "./StatementsScreen";
import { PaymentsScreen } from "./PaymentsScreen";
import { ActivityScreen } from "./ActivityScreen";
import { PlansScreen } from "./PlansScreen";
import { InsightsScreen } from "./InsightsScreen";
import { PortfolioScreen } from "./PortfolioScreen";
import { axeViolations } from "../testing/axe";

jest.mock("../HistoryChart", () => ({ HistoryChart: ({ title }: { title: string }) => <figure aria-label={title}><figcaption>{title}</figcaption></figure> }));
jest.mock("../BalanceHistory", () => ({ BalanceHistory: () => <figure aria-label="Balance over time" /> }));

const noop = () => {};
const bodyRows = (table: HTMLElement) => within(table).getAllByRole("row").filter((row) => row.hasAttribute("data-row-key"));
/** Elements a Tab key press can reach inside `root`. */
const tabStops = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")]
  .filter((element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"));

function scenario(kind: "full" | "late" | "carry", signedBalanceMinor = -123000) {
  const result = statementScenario(kind);
  const entry = cardEntry(result.card, result.workspace, result.snapshot, { today: "2026-10-15", signedBalanceMinor });
  return { ...result, entry };
}

function overview(entry: ReturnType<typeof scenario>["entry"], workspace = entry.view.statementWorkspace, handlers: Partial<Parameters<typeof OverviewScreen>[0]> = {}) {
  return render(<OverviewScreen budget="scenarios" entry={entry} workspace={workspace} onStatement={noop} onEnter={noop} onReview={noop}
    onActivityCurrent={noop} onPlans={noop} onPayment={noop} {...handlers} />);
}

describe("Overview", () => {
  it("puts what needs you first, then the next payment and Total owed", () => {
    const { entry, workspace } = scenario("late");
    const onStatement = jest.fn();
    overview(entry, workspace, { onStatement });
    const attention = screen.getByRole("region", { name: "Needs your attention" });
    expect(attention).toHaveTextContent("Statement 30 Sep · Overdue · 1,110.00 left to pay");
    fireEvent.click(within(attention).getByRole("button", { name: "Open" }));
    expect(onStatement).toHaveBeenCalledWith(entry.view.bank!.id);
    const next = screen.getByRole("region", { name: "Next payment" });
    expect(next).toHaveTextContent("1,110.00 left to pay");
    expect(within(next).getByText("Overdue")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Total owed" })).getByText("1,230.00")).toBeVisible();
    // UI-7, UI-8: no recent panels, card terms panel or inline activity table.
    expect(screen.queryByRole("region", { name: "Recent payments" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Card terms" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View activity/ })).not.toBeInTheDocument();
  });

  it("shows a bill with the minimum paid as not overdue", () => {
    const { entry, workspace } = scenario("carry");
    overview(entry, workspace);
    const next = screen.getByRole("region", { name: "Next payment" });
    expect(within(next).getByText("Minimum paid")).toBeVisible();
    expect(next).toHaveTextContent("200.00 paid of");
    expect(next.querySelector("details")).toBeNull();
  });

  it.each([true, false])("keeps refunds out of Paid and the minimum (cleared: %s)", (cleared) => {
    const context = setup({}, [facts("2026-09-30", 200000, { periodStart: "2026-09-01", dueDate: "2026-10-20", minimumDueMinor: 10000, previousBalanceMinor: 0 })]);
    const read = snapshot([
      row({ id: "spend", date: "2026-09-10", amount: -200000, categoryId: "shopping" }),
      row({ id: "new-purchase", date: "2026-10-08", amount: -8000, categoryId: "shopping" }),
      row({ id: "refund", date: "2026-10-09", amount: 2000, payeeName: "Merchant refund", categoryId: "shopping", cleared }),
    ], { from: "2026-08-01", to: "2026-10-15" });
    const entry = cardEntry(context.card(), context.workspace(), read, { today: "2026-10-15", signedBalanceMinor: -206000 });
    const onActivityCurrent = jest.fn();
    overview(entry, context.workspace(), { onActivityCurrent });
    const next = screen.getByRole("region", { name: "Next payment" });
    expect(next).toHaveTextContent("2,000.00 left to pay");
    expect(next).toHaveTextContent("0.00 paid of 2,000.00 amount due · minimum left 100.00");
    expect(within(next).getByRole("progressbar", { name: "Amount due paid" })).toHaveAttribute("aria-valuenow", "0");
    const owed = screen.getByRole("region", { name: "Total owed" });
    expect(within(owed).getByText("2,060.00")).toBeVisible();
    fireEvent.click(within(owed).getByRole("button", { name: "2 transactions →" }));
    expect(onActivityCurrent).toHaveBeenCalled();
  });

  it("shows plan-account principal inside Total owed and in the plans summary (D22)", () => {
    const plan = laptopPlanScenario();
    const card = { ...plan.card(), creditLimitMinor: 5000000 };
    const entry = cardEntry(card, plan.workspace(), plan.snapshot, { today: plan.today, signedBalanceMinor: plan.signedBalanceMinor });
    overview(entry, plan.workspace());
    const owed = screen.getByRole("region", { name: "Total owed" });
    expect(within(owed).getByText("24,000.00")).toBeVisible();
    expect(within(owed).getByText("On card").nextElementSibling).toHaveTextContent("-1,000.00");
    expect(within(owed).getByText("In plan accounts").nextElementSibling).toHaveTextContent("25,000.00");
    expect(within(screen.getByRole("region", { name: "Instalment plans" })).getByText("Laptop")).toBeVisible();
  });
});

describe("Statements", () => {
  function statements(kind: "full" | "late" = "full", panelId: string | null = null) {
    const result = scenario(kind);
    const onPanel = jest.fn();
    const view = render(<StatementsScreen entry={result.entry} workspace={result.workspace} eligible filter="all" onFilter={noop} panelId={panelId}
      onPanel={onPanel} onEnter={noop} onEdit={noop} onReview={noop} onAction={noop} onPayment={noop} />);
    return { ...result, onPanel, view };
  }

  it("shows every bill figure in one grouped table: amount due, paid, left to pay and due date (UI-3)", () => {
    statements("late");
    const table = screen.getByRole("table", { name: "Statements for Visa" });
    for (const name of ["On the bank statement", "This bill", "Status"]) expect(within(table).getByRole("columnheader", { name })).toBeVisible();
    for (const name of ["Due", "Amount due", "Minimum due", "Paid", "Left to pay", "Payment against due date", "Payment", "Bank match"]) {
      expect(within(table).getByRole("columnheader", { name })).toBeVisible();
    }
    const latest = bodyRows(table)[0];
    expect(latest).toHaveAccessibleName("Statement 30 Sep 2026 · Overdue · Matches bank");
    expect(within(latest).getAllByRole("cell")[1]).toHaveTextContent("01 Oct");
    // One line per row: cells hold a single value, never a second muted line.
    expect(table.querySelectorAll("tbody td .text-\\[11px\\]")).toHaveLength(0);
    expect(latest).toHaveTextContent("1,110.00");
    expect(within(table).getByText("Totals")).toBeVisible();
    expect(table.querySelector("details")).toBeNull();
  });

  it("shows each bill's payment against its due date, with the date, and keeps Paid in one column", () => {
    statements("late");
    const table = screen.getByRole("table", { name: "Statements for Visa" });
    const column = within(table).getAllByRole("columnheader").filter((header) => header.getAttribute("scope") === "col")
      .findIndex((header) => header.textContent === "Payment against due date");
    const cells = bodyRows(table).map((item) => within(item).getAllByRole("cell")[column].textContent ?? "");
    expect(cells[0]).toMatch(/^\d+ days overdue · unpaid$/);
    expect(cells.some((text) => /^\d\d \w{3}( \d{4})? · \d+ days? late$/.test(text))).toBe(true);
    expect(cells.some((text) => /^\d\d \w{3}( \d{4})? · on time$/.test(text))).toBe(true);
    for (const name of ["Pending", "Unpaid at due"]) expect(within(table).queryByRole("columnheader", { name })).not.toBeInTheDocument();
  });

  it("is one tab stop; arrows move and Enter opens the panel; there is no timeline", () => {
    const { onPanel, workspace } = statements();
    const table = screen.getByRole("table", { name: "Statements for Visa" });
    expect(tabStops(table)).toHaveLength(1);
    expect(screen.queryByRole("grid", { name: "Bills and payments" })).not.toBeInTheDocument();
    const rows = bodyRows(table);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(rows[1], { key: "Enter" });
    expect(onPanel).toHaveBeenCalledWith(workspace.statements.find((statement) => rows[1].getAttribute("data-row-key") === statement.id)!.id);
  });

  it("opens the statement panel with the bank figures, this bill and its payments; ↑/↓ and Esc", () => {
    const result = scenario("full");
    const latest = [...result.workspace.statements].sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
    const onPanel = jest.fn();
    render(<StatementsScreen entry={result.entry} workspace={result.workspace} eligible filter="all" onFilter={noop} panelId={latest.id}
      onPanel={onPanel} onEnter={noop} onEdit={noop} onReview={noop} onAction={noop} onPayment={noop} />);
    const panel = screen.getByRole("complementary", { name: "Statement 30 Sep" });
    for (const name of ["On the bank statement", "This bill", "Payments toward this bill"]) {
      expect(within(panel).getByRole("region", { name })).toBeVisible();
    }
    for (const name of ["Edit figures", "Reset review", "Delete statement"]) expect(within(panel).getByRole("button", { name })).toBeVisible();
    // The bank-match badge opens the review; there is no separate Review transactions button.
    expect(within(panel).getByRole("button", { name: /^Matches bank.*Review transactions$/ })).toBeVisible();
    expect(within(within(panel).getByRole("region", { name: "This bill" })).getAllByText("Paid in full")).toHaveLength(1);
    expect(within(panel).getByText("↑/↓ other statements")).toBeVisible();
    fireEvent.keyDown(within(panel).getByRole("heading", { name: "Statement 30 Sep" }), { key: "ArrowDown" });
    expect(onPanel).toHaveBeenLastCalledWith(result.workspace.statements.find((statement) => statement.closingDate === "2026-08-31")!.id);
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onPanel).toHaveBeenLastCalledWith(null);
  });

  it("offers Review on statements that need it and a transactions icon on the rest", () => {
    statements("full");
    const table = screen.getByRole("table", { name: "Statements for Visa" });
    const latest = bodyRows(table)[0];
    expect(within(latest).getByRole("button", { name: /^Review transactions of / })).toBeInTheDocument();
  });
});

describe("Payments", () => {
  it("summarises payments, filters them and opens a panel with both legs", () => {
    const { entry } = scenario("late");
    const onPanel = jest.fn();
    const { rerender } = render(<PaymentsScreen entry={entry} accounts={[{ id: "checking", name: "Checking" }]} filter={null} onFilter={noop} panelId={null} onPanel={onPanel} onStatement={noop} />);
    expect(screen.getByText(/^Paid/)).toHaveTextContent(/paid in full · \d+ late · 0 pending/);
    const table = screen.getByRole("table", { name: "Payments to Visa" });
    expect(tabStops(table)).toHaveLength(1);
    const first = bodyRows(table)[0];
    expect(first).toHaveTextContent("Checking");
    fireEvent.click(first);
    const id = first.getAttribute("data-row-key")!;
    expect(onPanel).toHaveBeenCalledWith(id);
    rerender(<PaymentsScreen entry={entry} accounts={[{ id: "checking", name: "Checking" }]} filter="late" onFilter={noop} panelId={id} onPanel={onPanel} onStatement={noop} />);
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByRole("region", { name: "Pays statement" })).toBeVisible();
    expect(within(panel).getByRole("region", { name: "From" })).toHaveTextContent("Checking");
    expect(bodyRows(screen.getByRole("table", { name: "Payments to Visa" })).every((row) => /late/.test(row.textContent ?? ""))).toBe(true);
  });
});

describe("Activity", () => {
  it("shows the Plan column from plan ownership and three type chip states (PL-7, UI-4)", () => {
    const plan = laptopPlanScenario();
    const entry = cardEntry(plan.card(), plan.workspace(), plan.snapshot, { today: plan.today, signedBalanceMinor: plan.signedBalanceMinor });
    render(<ActivityScreen budget="budget" entry={entry} workspace={plan.workspace()} snapshot={plan.snapshot} available statementFilter={null} planFilter={null}
      typeFilter={null} onFilters={noop} onMappings={noop} onMakePlan={noop} onOpenPlan={noop} />);
    const table = screen.getByRole("table", { name: "Activity for Visa" });
    expect(within(table).getByRole("columnheader", { name: "Plan" })).toBeVisible();
    const conversion = within(table).getByRole("row", { name: /^Transfer.* · 12 Jun 2026 · 30,000.00$|conversion/i });
    expect(conversion).toHaveTextContent("Laptop");
    expect(conversion).toHaveTextContent("Conversion");
    expect(conversion).toHaveTextContent("Plan conversion");
    expect(tabStops(table)).toHaveLength(1);
  });

  it("filters by statement, opens the shared type menu with T and selects with Space", async () => {
    const { card, workspace, snapshot: source } = statementScenario("full");
    const entry = cardEntry(card, workspace, source, { today: "2026-10-15", signedBalanceMinor: -1000 });
    const july = workspace.statements.find((statement) => statement.closingDate === "2026-07-31")!;
    const onFilters = jest.fn();
    render(<ActivityScreen budget="scenarios" entry={entry} workspace={workspace} snapshot={source} available statementFilter={july.id} planFilter={null}
      typeFilter={null} onFilters={onFilters} onMappings={noop} onMakePlan={noop} onOpenPlan={noop} />);
    const table = screen.getByRole("table", { name: "Activity for Visa" });
    const rows = bodyRows(table);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((item) => item.textContent?.includes("31 Jul"))).toBe(true);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: " " });
    expect(screen.getByRole("region", { name: "Selected transactions" })).toHaveTextContent("1 selected");
    fireEvent.keyDown(rows[0], { key: "t" });
    const menu = await screen.findByRole("dialog", { name: /^Type of/ });
    expect(within(menu).getByRole("radiogroup", { name: "Type" })).toBeVisible();
    fireEvent.click(within(menu).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Type of/ })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Suggested/ }));
    expect(onFilters).toHaveBeenCalledWith({ view: "suggested" });
  });
});

describe("Plans", () => {
  it("lists plans with status text, opens one, and adds a plan from the tab", () => {
    const plan = laptopPlanScenario();
    const entry = cardEntry(plan.card(), plan.workspace(), plan.snapshot, { today: plan.today, signedBalanceMinor: plan.signedBalanceMinor });
    const onAdd = jest.fn();
    const onOpenPlan = jest.fn();
    render(<PlansScreen budget="budget" entry={entry} workspace={plan.workspace()} canEdit planId={null} onOpenPlan={onOpenPlan}
      onAdd={onAdd} onEdit={noop} onActivity={noop} />);
    expect(screen.queryByRole("region", { name: "Plan accounts" })).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Instalment plans for Visa" });
    expect(bodyRows(table)[0]).toHaveTextContent("Laptop");
    expect(bodyRows(table)[0]).toHaveTextContent("25,000.00");
    expect(within(table).getByRole("columnheader", { name: /Original amount/ })).toBeInTheDocument();
    expect(bodyRows(table)[0]).toHaveTextContent("30,000.00");
    fireEvent.keyDown(bodyRows(table)[0], { key: "Enter" });
    expect(onOpenPlan).toHaveBeenCalledWith("plan");
    fireEvent.click(screen.getByRole("button", { name: "Add instalment plan" }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("shows a plan full width: summary with progress, and one timeline of the schedule and its transactions", () => {
    const plan = laptopPlanScenario();
    const entry = cardEntry(plan.card(), plan.workspace(), plan.snapshot, { today: plan.today, signedBalanceMinor: plan.signedBalanceMinor });
    const onOpenPlan = jest.fn();
    const onEdit = jest.fn();
    render(<PlansScreen budget="budget" entry={entry} workspace={plan.workspace()} canEdit planId="plan" onOpenPlan={onOpenPlan}
      onAdd={noop} onEdit={onEdit} onActivity={noop} />);
    const strip = screen.getByLabelText("Plan Laptop");
    expect(within(strip).getByText("Remaining").nextElementSibling).toHaveTextContent("25,000.00");
    expect(within(strip).getByText("Progress")).toBeInTheDocument();
    const timeline = screen.getByRole("table", { name: "Timeline for plan Laptop" });
    expect(bodyRows(timeline).length).toBeGreaterThan(0);
    expect(timeline).toHaveTextContent("Booked");
    for (const name of ["Dates", "Amount", "Transaction"]) expect(within(timeline).getByRole("columnheader", { name })).toBeInTheDocument();
    for (const name of [/^Due/, /^Date(?!s)/, /^Expected/, /^Actual/, /^Remaining/, /^Category/, /^Notes/, "Cleared", /^Statement/]) {
      expect(within(timeline).getByRole("columnheader", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("region", { name: "Schedule" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    expect(onEdit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "All plans" }));
    expect(onOpenPlan).toHaveBeenCalledWith(null);
  });
;
});

describe("Add transaction in the plan view", () => {
  it("finds a card transaction, proposes its role from the sign and links it; plan-account plans explain instead", async () => {
    // The dialog saves through the app's store, so this test registers the card there.
    resetCreditCardStore();
    const card = addCard(creditCardStore, CARD_INPUT);
    const purchase = row({ id: "laptop", date: "2026-08-10", amount: -600000, payeeName: "Laptop store" });
    const coffee = row({ id: "coffee", date: "2026-08-11", amount: -1500, payeeName: "Coffee" });
    const read = snapshot([purchase, coffee], { from: "2026-08-01", to: "2026-10-16" });
    await creditCardStore.getState().savePlan(BUDGET, null, read, {
      id: "plan", cardId: card.id, revision: 1, name: "Laptop", recordedAs: "card-instalments", originalAmountMinor: 600000, startDate: "2026-08-10",
    }, []);
    const workspace = creditCardStore.getState().workspaces[BUDGET];
    const entry = cardEntry(workspace.cards[0], workspace, read, { today: "2026-10-16", signedBalanceMinor: -601500 });
    render(<PlansScreen budget={BUDGET} entry={entry} workspace={workspace} canEdit planId="plan" onOpenPlan={noop}
      onAdd={noop} onEdit={noop} onActivity={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    const dialog = screen.getByRole("dialog", { name: "Add a transaction to Laptop" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Find a card transaction" }), { target: { value: "laptop" } });
    const list = within(dialog).getByRole("list", { name: "Card transactions" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(list).getByRole("button", { name: /Laptop store/ }));
    expect(within(dialog).getByLabelText("Role")).toHaveTextContent("Original purchase");
    fireEvent.click(within(dialog).getByRole("button", { name: "Link" }));
    await waitFor(() => expect(creditCardStore.getState().workspaces[BUDGET].planEntries)
      .toEqual([expect.objectContaining({ planId: "plan", transactionId: "laptop", role: "original" })]));
  });

  it("offers no second original purchase once one is linked", async () => {
    resetCreditCardStore();
    const card = addCard(creditCardStore, CARD_INPUT);
    const purchase = row({ id: "laptop", date: "2026-08-10", amount: -600000, payeeName: "Laptop store" });
    const case_ = row({ id: "case", date: "2026-08-11", amount: -4000, payeeName: "Case shop" });
    const read = snapshot([purchase, case_], { from: "2026-08-01", to: "2026-10-16" });
    await creditCardStore.getState().savePlan(BUDGET, null, read, {
      id: "plan", cardId: card.id, revision: 1, name: "Laptop", recordedAs: "card-instalments", originalAmountMinor: 600000, startDate: "2026-08-10",
    }, [planEntryFor("plan", purchase, "original", null)]);
    const workspace = creditCardStore.getState().workspaces[BUDGET];
    const entry = cardEntry(workspace.cards[0], workspace, read, { today: "2026-10-16", signedBalanceMinor: -604000 });
    render(<PlansScreen budget={BUDGET} entry={entry} workspace={workspace} canEdit planId="plan" onOpenPlan={noop}
      onAdd={noop} onEdit={noop} onActivity={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    const dialog = screen.getByRole("dialog", { name: "Add a transaction to Laptop" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Case shop/ }));
    expect(within(dialog).getByLabelText("Role")).not.toHaveTextContent("Original purchase");
  });

  it("explains that plan-account transfers belong by tag, and offers only the original purchase to add", () => {
    const plan = laptopPlanScenario();
    const entry = cardEntry(plan.card(), plan.workspace(), plan.snapshot, { today: plan.today, signedBalanceMinor: plan.signedBalanceMinor });
    render(<PlansScreen budget="budget" entry={entry} workspace={plan.workspace()} canEdit planId="plan" onOpenPlan={noop}
      onAdd={noop} onEdit={noop} onActivity={noop} />);
    expect(screen.queryByRole("button", { name: "Add transaction" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Timeline" })).toHaveTextContent(/belong here/);
    fireEvent.click(screen.getByRole("button", { name: "Add original purchase" }));
    expect(screen.getByRole("dialog", { name: "Add the original purchase to Laptop" })).toBeVisible();
    expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
  });

  it("hides Add original purchase once it is linked, and explains a plan that started before tracking", async () => {
    const linked = laptopPlanScenario();
    const plan = linked.workspace().plans[0];
    const laptop = linked.snapshot.rows.find((item) => item.id === "laptop")!;
    await linked.store.getState().savePlan(BUDGET, plan.revision, linked.snapshot, plan, [planEntryFor(plan.id, laptop, "original", null)]);
    const entry = cardEntry(linked.card(), linked.workspace(), linked.snapshot, { today: linked.today, signedBalanceMinor: linked.signedBalanceMinor });
    const { unmount } = render(<PlansScreen budget="budget" entry={entry} workspace={linked.workspace()} canEdit planId="plan" onOpenPlan={noop}
      onAdd={noop} onEdit={noop} onActivity={noop} />);
    expect(screen.queryByRole("button", { name: "Add original purchase" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Timeline" })).not.toHaveTextContent(/before tracking/);
    unmount();

    const early = laptopPlanScenario();
    const read = { ...early.snapshot, from: "2026-07-01", rows: early.snapshot.rows.filter((item) => item.date >= "2026-07-01") };
    const later = cardEntry(early.card(), early.workspace(), read, { today: early.today, signedBalanceMinor: early.signedBalanceMinor });
    render(<PlansScreen budget="budget" entry={later} workspace={early.workspace()} canEdit planId="plan" onOpenPlan={noop}
      onAdd={noop} onEdit={noop} onActivity={noop} />);
    expect(screen.queryByRole("button", { name: "Add original purchase" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Timeline" })).toHaveTextContent(/started before tracking .*original amount and start date already cover it/);
  });
;
});

describe("Instalment plans found in plan accounts", () => {
  it("lists plans found from #tags, hands one to the editor, and explains a transfer with two plan tags", async () => {
    const test = setup({});
    test.store.getState().setPlanAccounts("budget", ["loans"]);
    const legs = [
      transfer("bt", "2025-08-09", 3864000, "loans", { notes: "#2025-09 #EMI_BT #BANK BALANCE TRANSFER" }),
      transfer("bt-1", "2025-09-06", -3864000, "loans", { notes: "#2025-09 #EMI_BT #BANK Final" }),
      transfer("qc", "2025-12-30", 5000000, "loans", { notes: "#2025-12 #EMI_QC #BANK QUICK CASH" }),
      transfer("mix", "2026-01-05", -10000, "loans", { notes: "#EMI_BT #EMI_QC" }),
    ];
    const read = snapshot(legs.map((leg) => leg.card), { from: "2025-01-01", to: "2026-10-16", planAccounts: { loans: { rows: legs.map((leg) => leg.peer) } } });
    const entry = cardEntry(test.card(), test.workspace(), read, { today: "2026-10-16", signedBalanceMinor: 0 });
    const onAddFound = jest.fn();
    const { container } = render(<PlansScreen budget="budget" entry={entry} workspace={test.workspace()} canEdit planId={null} onOpenPlan={noop}
      onAdd={noop} onAddFound={onAddFound} onEdit={noop} onActivity={noop} />);
    const found = screen.getByRole("region", { name: "Found in your plan accounts" });
    expect(found).toHaveTextContent("2 instalment plans found in your plan accounts");
    expect(found).toHaveTextContent("BALANCE TRANSFER");
    expect(found).toHaveTextContent(/Finished/);
    expect(found).toHaveTextContent("50,000.00 remaining");
    fireEvent.click(within(found).getAllByRole("button", { name: "Add plan" })[0]);
    expect(onAddFound).toHaveBeenCalledWith(expect.objectContaining({ tag: "#EMI_QC", accountId: "loans", originalMinor: 5000000 }));
    expect(screen.getByRole("status")).toHaveTextContent("1 transfer carries two plan tags");
    expect(screen.queryByRole("region", { name: "Plan account entries without a plan" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Insights", () => {
  it("compacts known-zero interest, reports fees as 0, and shows the minimum-only estimate without a toggle", () => {
    const { entry, workspace, card } = scenario("full", -12000);
    const withRule = { ...entry, card: { ...card, minimumPercentBps: 500, minimumFloorMinor: 10000 } };
    render(<InsightsScreen entry={withRule} workspace={workspace} onStatement={noop} onSettings={noop} />);
    expect(screen.queryByRole("figure", { name: "Interest charged, running total" })).not.toBeInTheDocument();
    expect(screen.getByText("Fees").nextElementSibling).toHaveTextContent("0.00");
    expect(screen.getByRole("region", { name: "Payment track record" })).toHaveTextContent(/paid in full by the due date/);
    expect(screen.getByText(/not a bank payoff quote/)).toBeVisible();
    expect(screen.queryByText(/Hypothetical zero-interest baseline/)).not.toBeInTheDocument();
  });
});

describe("All cards", () => {
  it("shows five totals and one focusable row per card; Enter opens it and focus returns to it", async () => {
    const one = statementScenario("late");
    const entry = cardEntry({ ...one.card, creditLimitMinor: 5000000 }, one.workspace, one.snapshot, { today: "2026-10-15", signedBalanceMinor: -123000 });
    const onOpen = jest.fn();
    render(<PortfolioScreen entries={[entry]} workspace={one.workspace} sort="due" onSort={noop} focusCardId={one.card.id} onOpen={onOpen} />);
    const totals = screen.getByLabelText("All cards");
    const value = (label: string) => within(totals).getByText(label).nextElementSibling!;
    expect(totals.querySelectorAll(":scope > div")).toHaveLength(5);
    expect(value("Left to pay")).toHaveTextContent("1,110.00");
    expect(value("Total owed")).toHaveTextContent("1,230.00");
    expect(value("Available credit")).toHaveTextContent("48,770.00");
    const table = screen.getByRole("table", { name: "Cards" });
    expect(tabStops(table)).toHaveLength(1);
    const card = bodyRows(table)[0];
    await waitFor(() => expect(card).toHaveFocus());
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(one.card.id);
  });

  it("shows every card figure in two-line rows: terms under the name, related figures under each value, none under the badge", () => {
    const plan = laptopPlanScenario();
    const entry = cardEntry({ ...plan.card(), creditLimitMinor: 5000000, purchaseAprBps: 2400, network: "mastercard" }, plan.workspace(), plan.snapshot,
      { today: plan.today, signedBalanceMinor: plan.signedBalanceMinor });
    render(<PortfolioScreen entries={[entry]} workspace={plan.workspace()} sort="due" onSort={noop} focusCardId={null} onOpen={noop} />);
    const table = screen.getByRole("table", { name: "Cards" });
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.trim());
    expect(headers).toEqual(["Card", "Next payment", "Due date", "Left to pay", "Statement balance", "Total owed", "In plan accounts", "Credit used", "Needs attention"]);
    const cells = within(bodyRows(table)[0]).getAllByRole("cell");
    const cell = (name: string) => cells[headers.indexOf(name)];
    expect(cell("Card")).toHaveTextContent(/^VisaLimit 50,000\.00 · 24% APR · closes \d+(st|nd|rd|th)$/);
    expect(cell("Next payment").textContent).toBe(cell("Next payment").querySelector("span")?.textContent);
    expect(cell("Left to pay")).toHaveTextContent(/minimum /);
    expect(cell("Statement balance")).toHaveTextContent(/verified|not verified/);
    expect(cell("Total owed")).toHaveTextContent(/since statement/);
    expect(cell("In plan accounts")).toHaveTextContent("1 plan");
    expect(cell("Credit used")).toHaveTextContent(/\d available$/);
  });

  it("uses the limit in effect today for Available credit and Credit used after a mid-month change", () => {
    const one = statementScenario("late");
    const workspace = { ...one.workspace, limitChanges: [{ cardId: one.card.id, effectiveDate: "2026-09-14", limitMinor: 10000000 }] };
    const entry = cardEntry({ ...one.card, creditLimitMinor: 5000000 }, workspace, one.snapshot, { today: "2026-10-15", signedBalanceMinor: -123000 });
    render(<PortfolioScreen entries={[entry]} workspace={workspace} sort="due" onSort={noop} focusCardId={null} onOpen={noop} />);
    const totals = screen.getByLabelText("All cards");
    expect(within(totals).getByText("Available credit").nextElementSibling).toHaveTextContent("98,770.00");
    const cells = within(bodyRows(screen.getByRole("table", { name: "Cards" }))[0]).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Limit 100,000.00");
  });

  it("searches cards, keeps the totals for all cards, and opens trends in a docked panel", () => {
    const one = statementScenario("late");
    const entry = cardEntry({ ...one.card, creditLimitMinor: 5000000 }, one.workspace, one.snapshot, { today: "2026-10-15", signedBalanceMinor: -123000 });
    render(<PortfolioScreen entries={[entry]} workspace={one.workspace} sort="due" onSort={noop} focusCardId={null} onOpen={noop} />);
    expect(screen.queryByRole("figure", { name: "Total owed over time" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search cards" }), { target: { value: "no such card" } });
    expect(screen.getByText("No results match your filters.")).toBeVisible();
    expect(within(screen.getByLabelText("All cards")).getByText("Total owed").nextElementSibling).toHaveTextContent("1,230.00");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(bodyRows(screen.getByRole("table", { name: "Cards" }))).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Trends" }));
    const panel = screen.getByRole("complementary", { name: "Trends" });
    expect(within(panel).getByRole("figure", { name: "Total owed over time" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Statement balances" }));
    expect(within(panel).getByRole("figure", { name: "Statement balances" })).toBeInTheDocument();
  });
});

it("explains activity coverage on Overview without blaming uncleared entries", () => {
  const context = setup({}, [facts("2026-09-30", 0, { periodStart: "2026-09-01", dueDate: "2026-10-20", previousBalanceMinor: 0 })]);
  const pay = transfer("pay", "2026-10-05", 1000, BANK_ACCOUNT, { cleared: false });
  const read = snapshot([pay.card], { from: "2026-08-01", to: "2026-10-14" });
  const entry = cardEntry(context.card(), context.workspace(), read, { today: "2026-10-15", signedBalanceMinor: sumMinor(read.rows.map((item) => item.amountMinor)) });
  act(() => { overview(entry, context.workspace()); });
  expect(within(screen.getByRole("region", { name: "Total owed" })).getByRole("status")).toHaveTextContent("Activity read through 14 Oct. Refresh for today.");
});
