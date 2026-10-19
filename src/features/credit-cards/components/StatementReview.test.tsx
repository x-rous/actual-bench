import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { statementScenario } from "../lib/statementScenarios.fixture";
import { StatementReview } from "./StatementReview";
import { cardEntry } from "./entryKit";
import { creditCardStore } from "../lib/store/store";
import { resetCreditCardStore, addStatement, addCard, BUDGET, CARD_INPUT, row, snapshot } from "../lib/fixtures/testKit";
import type { ActivitySnapshot } from "../lib/activity";
import type { Statement, StatementFactsInput, Workspace } from "../lib/models";

const ON = "On this statement";
const OFF = "Not on this statement";
const UNSURE = "Unsure";

const answers = (payee: string) => screen.getByRole("radiogroup", { name: new RegExp(`^On this statement\\? ${payee} ·`) });
function choose(payee: string, label: string) {
  fireEvent.click(within(answers(payee)).getByRole("radio", { name: label }));
  expect(within(answers(payee)).getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
}

function setup(statements: StatementFactsInput[]) {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { ...CARD_INPUT, closingDay: 30 });
  const saved = statements.map((facts) => addStatement(creditCardStore, BUDGET, card.id, facts));
  const workspace = () => creditCardStore.getState().workspaces[BUDGET];
  return { card, saved, workspace };
}

function review(statement: Statement, workspace: Workspace, read: ActivitySnapshot, onClose = jest.fn(), budget = BUDGET, onEditFigures?: () => void) {
  const card = workspace.cards.find((entry) => entry.id === statement.cardId)!;
  const entry = cardEntry(card, workspace, read, { today: "2026-11-05" });
  return render(<StatementReview budget={budget} statement={statement} entry={entry} workspace={workspace} snapshot={read} available onClose={onClose}
    onEditFigures={onEditFigures} />);
}

const september = { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", balanceMinor: 2000, minimumDueMinor: 100 };
const october = { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-20", balanceMinor: 4000, minimumDueMinor: 100 };

it("opens on All, links the undecided count to To decide, searches notes and saves every answer even when rows are filtered", async () => {
  const { saved, workspace } = setup([september]);
  const rows = ["Zulu", "Alpha"].map((label, index) => row({ id: label, date: "2026-09-30", amount: -1000, payeeName: label, notes: index ? "Train receipt" : "Hotel receipt", categoryName: "Travel", categoryId: "travel" }));
  const close = jest.fn();
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }), close);
  const region = screen.getByRole("region", { name: /Review statement/ });
  expect(within(region).getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(screen.getByRole("group", { name: "Reconciliation" })).getByRole("button", { name: "2 transactions to decide" }));
  expect(within(region).getByRole("button", { name: /^To decide/ })).toHaveAttribute("aria-pressed", "true");
  expect(within(region).getByRole("button", { name: /Change type of Zulu/ })).toBeVisible();
  expect(region.querySelector("details")).toBeNull();
  fireEvent.click(within(region).getByRole("button", { name: /^All/ }));
  fireEvent.change(within(region).getByLabelText("Search statement transactions"), { target: { value: "Hotel receipt" } });
  expect(within(region).queryByText("Alpha")).not.toBeInTheDocument();
  choose("Zulu", OFF);
  choose("Zulu", ON);
  fireEvent.change(within(region).getByLabelText("Search statement transactions"), { target: { value: "" } });
  choose("Alpha", OFF);
  expect(screen.getByRole("button", { name: /^To decide/ })).toHaveTextContent("0");
  expect(screen.getByText("2 unsaved changes")).toBeVisible();
  fireEvent.click(within(region).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(workspace().decisions.map((entry) => [entry.transactionId, entry.decision]).sort()).toEqual([["Alpha", "excluded"], ["Zulu", "included"]]);
});

it("answers with Y, N and ? on the focused row; the table is one tab stop", () => {
  const { saved, workspace } = setup([september]);
  const rows = ["Alpha", "Beta"].map((label) => row({ id: label, date: "2026-09-10", amount: -1000, payeeName: label }));
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }));
  const table = screen.getByRole("table", { name: "Transactions on this statement" });
  // The rows are one tab stop; the header's select-all checkbox is the only other one (as on /payees).
  const focusable = [...table.querySelectorAll<HTMLElement>("tbody button, tbody input, tbody [tabindex]")].filter((element) => element.tabIndex >= 0);
  expect(focusable).toHaveLength(1);
  expect(within(table).getByRole("checkbox", { name: "Select all shown transactions" })).toBeInTheDocument();
  const first = within(table).getByRole("row", { name: /^Alpha/ });
  first.focus();
  fireEvent.keyDown(first, { key: "y" });
  expect(within(answers("Alpha")).getByRole("radio", { name: ON })).toHaveAttribute("aria-checked", "true");
  fireEvent.keyDown(first, { key: "n" });
  expect(within(answers("Alpha")).getByRole("radio", { name: OFF })).toHaveAttribute("aria-checked", "true");
  fireEvent.keyDown(first, { key: "?" });
  expect(within(answers("Alpha")).getByRole("radio", { name: UNSURE })).toHaveAttribute("aria-checked", "true");
});

it("saves an opening statement without a previous balance as reviewed, not Matches bank (CA-13)", async () => {
  const { saved, workspace } = setup([september]);
  const close = jest.fn();
  review(saved[0], workspace(), snapshot([], { from: "2026-08-01", to: "2026-11-01" }), close);
  expect(screen.getByText(/Enter the previous balance in the bank figures/)).toBeVisible();
  expect(screen.getByText("Needs previous balance")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(workspace().statements[0]).toMatchObject({ reviewState: "reviewed" });
});

it("is saved as Matches bank when complete and the balance matches (D26)", () => {
  const { saved, workspace } = setup([{ ...september, balanceMinor: 1000, previousBalanceMinor: 0 }]);
  const rows = [row({ id: "shop", date: "2026-09-10", amount: -1000, payeeName: "Shop", categoryId: "shopping" })];
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }));
  expect(within(screen.getByRole("group", { name: "Reconciliation" })).getByText("Matches bank")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(workspace().statements[0]).toMatchObject({ reviewState: "verified" });
  expect(workspace().decisions).toEqual([expect.objectContaining({ transactionId: "shop", decision: "included", origin: "verification" })]);
});

it("stages type changes and saves them with the decisions in one Save (D29)", async () => {
  const { saved, workspace } = setup([september]);
  const rows = [row({ id: "fee", date: "2026-09-10", amount: -2000, payeeName: "Bank charge" })];
  const close = jest.fn();
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }), close);
  fireEvent.click(screen.getByRole("button", { name: /Change type of Bank charge/ }));
  const menu = await screen.findByRole("dialog", { name: "Type of Bank charge" });
  fireEvent.click(within(menu).getByRole("radio", { name: "Fee" }));
  fireEvent.click(within(menu).getByRole("button", { name: "Set type" }));
  expect(workspace().typeCorrections).toEqual([]);
  expect(screen.getByText("unsaved")).toBeVisible();
  choose("Bank charge", ON);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(workspace().typeCorrections).toEqual([expect.objectContaining({ transactionId: "fee", kind: "fee" })]);
  expect(workspace().decisions).toEqual([expect.objectContaining({ transactionId: "fee", decision: "included" })]);
});

it("answers selected rows across filters without writing until Save", () => {
  const { saved, workspace } = setup([september]);
  const rows = ["Alpha", "Beta"].map((label) => row({ id: label, date: "2026-09-10", amount: -1000, payeeName: label }));
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }));
  expect(screen.getByRole("heading", { name: /Review statement/ })).toHaveFocus();
  for (const label of ["Alpha", "Beta"]) fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`^Select ${label}`) }));
  fireEvent.click(within(screen.getByRole("region", { name: "Selected transactions" })).getByRole("button", { name: OFF }));
  expect(workspace().decisions).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  expect(within(answers("Beta")).getByRole("radio", { name: OFF })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(workspace().decisions.map((entry) => entry.decision)).toEqual(["excluded", "excluded"]);
});

it("locks boundary rows owned by September in October and releases them when September lets go", () => {
  const { saved, workspace } = setup([{ ...september, balanceMinor: 3000 }, october]);
  const rows = ["Border A", "Border B", "October shop"].map((label, index) => row({ id: label, date: index < 2 ? "2026-10-01" : "2026-10-10", amount: -1000, payeeName: label, notes: "#2026-10" }));
  const read = snapshot(rows, { from: "2026-08-01", to: "2026-11-03" });
  creditCardStore.getState().saveReview(BUDGET, saved[0].id, 1, read, rows.slice(0, 2).map((entry) => ({ transactionId: entry.id, decision: "included", bankPostingDate: null, note: null })));
  const { unmount } = review(workspace().statements[1], workspace(), read);
  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  for (const label of ["Border A", "Border B"]) expect(screen.queryByRole("radiogroup", { name: new RegExp(`${label} ·`) })).not.toBeInTheDocument();
  expect(screen.getAllByText("On statement 30 Sep 2026").length).toBeGreaterThanOrEqual(2);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(workspace().decisions.filter((entry) => entry.statementId === saved[1].id && entry.decision === "included").map((entry) => entry.transactionId)).toEqual(["October shop"]);
  expect(() => creditCardStore.getState().saveReview(BUDGET, saved[1].id, 2, read, [{ transactionId: "Border A", decision: "included", bankPostingDate: null, note: null }]))
    .toThrow("A transaction cannot belong to two statements");
  unmount();
  creditCardStore.getState().saveReview(BUDGET, saved[0].id, 2, read, rows.slice(0, 2).map((entry) => ({ transactionId: entry.id, decision: "excluded", bankPostingDate: null, note: null })));
  review(workspace().statements[1], workspace(), read);
  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  expect(within(answers("Border A")).getByRole("radio", { name: ON })).toBeEnabled();
});

it("stages a move to another statement without writing either until Save", async () => {
  const { saved, workspace } = setup([{ ...september, balanceMinor: 1000 }, { ...october, balanceMinor: 2000 }]);
  const rows = [
    row({ id: "matched", date: "2026-09-10", amount: -1000, payeeName: "Matched shop", notes: "#2026-09" }),
    row({ id: "exception", date: "2026-09-10", amount: -1000, payeeName: "Cutoff shop", notes: "#2026-09 #2026-10" }),
  ];
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-12-01" }));
  expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  expect(within(answers("Cutoff shop")).getByRole("radio", { name: UNSURE })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("checkbox", { name: /^Select Cutoff shop/ }));
  fireEvent.click(within(screen.getByRole("region", { name: "Selected transactions" })).getByRole("button", { name: "Move" }));
  const dialog = screen.getByRole("dialog", { name: "Move to another statement" });
  fireEvent.click(within(dialog).getByRole("combobox", { name: "Destination statement" }));
  const destination = screen.getByRole("option", { name: "31 Oct 2026" });
  fireEvent.pointerDown(destination, { pointerType: "mouse" });
  fireEvent.pointerUp(destination, { pointerType: "mouse" });
  fireEvent.mouseUp(destination);
  fireEvent.click(destination);
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Move" })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
  expect(workspace().decisions).toHaveLength(0);
  expect(await screen.findByText(/1 move staged/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const after = workspace();
  expect(after.decisions.find((entry) => entry.transactionId === "exception" && entry.statementId === saved[0].id)?.decision).toBe("excluded");
  expect(after.decisions.find((entry) => entry.transactionId === "exception" && entry.statementId === saved[1].id)?.decision).toBe("included");
  expect(after.statements.find((entry) => entry.id === saved[1].id)).toMatchObject({ reviewState: "not_reviewed", revision: 2 });
});

it("reports a difference without offering to accept it, and announces only the Difference line", () => {
  const { saved, workspace } = setup([{ ...september, balanceMinor: 1500, previousBalanceMinor: 0 }]);
  const rows = [row({ id: "shop", date: "2026-09-10", amount: -1000, payeeName: "Shop", categoryId: "shopping" })];
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }));
  const strip = screen.getByRole("group", { name: "Reconciliation" });
  expect(strip).toHaveTextContent("5.00");
  expect(within(strip).queryByRole("button", { name: /scope difference/i })).not.toBeInTheDocument();
  expect(within(strip).getAllByRole("status")).toHaveLength(1);
});

it("closes an unchanged review at once and asks before discarding answers", async () => {
  const scenario = statementScenario("full");
  const statement = scenario.rows.find((entry) => entry.closingDate === "2026-08-31")!;
  const onClose = jest.fn();
  review(statement, scenario.workspace, scenario.snapshot, onClose, "scenarios");
  fireEvent.click(screen.getByRole("button", { name: "Statements" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  fireEvent.click(within(screen.getAllByRole("radiogroup", { name: /Test merchant/ })[0]).getByRole("radio", { name: OFF }));
  fireEvent.click(screen.getByRole("button", { name: "Statements" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();
});

it("edits a note in its cell: Enter on the row opens it, Enter keeps it, Esc cancels", () => {
  const { saved, workspace } = setup([september]);
  const rows = [row({ id: "shop", date: "2026-09-10", amount: -1000, payeeName: "Shop" })];
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }));
  const shop = screen.getByRole("row", { name: /^Shop/ });
  shop.focus();
  fireEvent.keyDown(shop, { key: "Enter" });
  const input = screen.getByRole("textbox", { name: /^Note for Shop/ });
  fireEvent.change(input, { target: { value: "Posted next day" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("button", { name: /^Edit note for Shop/ })).toHaveTextContent("Posted next day");
  fireEvent.click(screen.getByRole("button", { name: /^Edit note for Shop/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /^Note for Shop/ }), { target: { value: "discard me" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: /^Note for Shop/ }), { key: "Escape" });
  expect(screen.getByRole("button", { name: /^Edit note for Shop/ })).toHaveTextContent("Posted next day");
  expect(screen.getByRole("columnheader", { name: "Cleared" })).toBeVisible();
  expect(within(shop).getByRole("img", { name: "Cleared" })).toBeVisible();
});

it("opens the plan editor right after Set type when Make this a plan is ticked", async () => {
  const { saved, workspace } = setup([september]);
  const rows = [row({ id: "tv", date: "2026-09-10", amount: -120000, payeeName: "TV store" })];
  const onMakePlan = jest.fn();
  const card = workspace().cards[0];
  const read = snapshot(rows, { from: "2026-08-01", to: "2026-11-01" });
  render(<StatementReview budget={BUDGET} statement={saved[0]} entry={cardEntry(card, workspace(), read, { today: "2026-11-05" })} workspace={workspace()}
    snapshot={read} available onClose={jest.fn()} onMakePlan={onMakePlan} />);
  fireEvent.click(screen.getByRole("button", { name: /Change type of TV store/ }));
  const menu = await screen.findByRole("dialog", { name: "Type of TV store" });
  fireEvent.click(within(menu).getByRole("checkbox"));
  fireEvent.click(within(menu).getByRole("button", { name: "Set type" }));
  expect(onMakePlan).toHaveBeenCalledWith("tv");
});

it("selects every shown row from the header checkbox and acts on them from a light selection bar under the toolbar", () => {
  const { saved, workspace } = setup([september]);
  const rows = ["Alpha", "Beta"].map((label) => row({ id: label, date: "2026-09-10", amount: -1000, payeeName: label }));
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }));
  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  const all = screen.getByRole("checkbox", { name: "Select all shown transactions" });
  fireEvent.click(all);
  const bar = screen.getByRole("region", { name: "Selected transactions" });
  expect(bar).toHaveTextContent("2 selected");
  expect(bar.className).not.toMatch(/bg-foreground/);
  // Save stays in the toolbar while rows are selected.
  expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
  fireEvent.click(all);
  expect(screen.queryByRole("region", { name: "Selected transactions" })).not.toBeInTheDocument();
});

it("reads as an equation: figures from decided rows while some are undecided, and the difference says what deciding them would do", () => {
  const { saved, workspace } = setup([{ ...september, previousBalanceMinor: 0 }]);
  const rows = ["Zulu", "Alpha"].map((label) => row({ id: label, date: "2026-09-30", amount: -1000, payeeName: label, categoryId: "travel" }));
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }));
  const strip = screen.getByRole("group", { name: "Reconciliation" });
  expect(strip).toHaveTextContent("−Payments & credits0.00");
  expect(strip).toHaveTextContent("2 transactions to decide · would match the bank");
  expect(strip).not.toHaveTextContent("if Yes");
  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  choose("Zulu", ON);
  choose("Alpha", ON);
  expect(within(strip).getByText("Matches bank")).toBeVisible();
});

it("opens Edit bank figures at once, or after discarding unsaved answers", () => {
  const { saved, workspace } = setup([september]);
  const rows = [row({ id: "Zulu", date: "2026-09-30", amount: -1000, payeeName: "Zulu", categoryId: "travel" })];
  const edit = jest.fn();
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }), jest.fn(), BUDGET, edit);
  expect(screen.queryByRole("button", { name: "Category mappings" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit bank figures" }));
  expect(edit).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  choose("Zulu", ON);
  fireEvent.click(screen.getByRole("button", { name: "Edit bank figures" }));
  expect(edit).toHaveBeenCalledTimes(1);
  fireEvent.click(within(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).getByRole("button", { name: "Discard changes" }));
  expect(edit).toHaveBeenCalledTimes(2);
  expect(screen.getByText("No unsaved changes")).toBeVisible();
});

it("shows #tags in notes in blue, and groups the bulk answers as one choice", () => {
  const { saved, workspace } = setup([september]);
  const rows = [row({ id: "Zulu", date: "2026-09-30", amount: -1000, payeeName: "Zulu", notes: "#2026-09 #EMI_A School fee", categoryId: "travel" })];
  review(saved[0], workspace(), snapshot(rows, { from: "2026-08-01", to: "2026-11-01" }));
  const tag = screen.getByText("#EMI_A");
  expect(tag).toHaveClass("text-blue-700");
  expect(screen.getByText("#2026-09")).toHaveClass("text-blue-700");
  expect(tag.parentElement).toHaveAttribute("title", "#2026-09 #EMI_A School fee");
  fireEvent.click(screen.getByRole("checkbox", { name: /^Select Zulu/ }));
  const group = within(screen.getByRole("region", { name: "Selected transactions" })).getByRole("group", { name: "Answer for the selected transactions" });
  expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([ON, OFF, UNSURE]);
});
