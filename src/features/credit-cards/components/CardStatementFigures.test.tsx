import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import { creditCardStore } from "../lib/store/store";
import { addCard, addStatement, BUDGET, CARD_ACCOUNT, CARD_INPUT, facts, resetCreditCardStore } from "../lib/fixtures/testKit";
import type { ActivityRow } from "../lib/activity";
import type { StatementDraft } from "../lib/cycles";
import {
  CardStatementFigures, CardStatementHeaderAction, cardStatementReviewHref, periodMismatch, ReviewCardStatementLink, statementChoices, suggestedChoice,
} from "./CardStatementFigures";

const mockActivity = {
  data: {
    accountId: CARD_ACCOUNT, from: "2026-01-01", to: "2026-12-31", rows: [] as ActivityRow[], counterparts: [] as ActivityRow[],
    issues: [] as string[], fetchedAt: "2026-10-10T12:00:00Z", directBalanceAdjustmentMinor: 0, futureDeltaMinor: 0, signature: "empty",
  },
  isPending: false,
  isError: false,
};
jest.mock("../hooks/useCreditCardActivity", () => ({
  useCreditCardActivities: (_connection: unknown, cards: unknown[]) => cards.map(() => mockActivity),
  useCreditCardPlanAccounts: () => [],
}));
jest.mock("../hooks/useCreditCardDirectory", () => ({
  useCreditCardDirectory: () => ({ data: undefined, isFetching: false, isError: false }),
}));

const connection: ConnectionInstance = { id: "connection", budgetSyncId: BUDGET, label: "Budget", mode: "http-api", baseUrl: "http://localhost", apiKey: "test" };
const draft = (closingDate: string, dueDate: string): StatementDraft => ({
  periodStart: `${closingDate.slice(0, 8)}01`, closingDate, dueDate, balanceMinor: 0, minimumDueMinor: 0, minimumKnown: false,
} as StatementDraft);

beforeEach(() => {
  resetCreditCardStore();
  useConnectionStore.setState({ instances: [connection], activeInstanceId: connection.id });
});

it("lists saved statements and estimates newest first, and suggests the earliest one not entered", () => {
  const card = addCard(creditCardStore, CARD_INPUT);
  const saved = addStatement(creditCardStore, BUDGET, card.id, facts("2026-08-10", 1000));
  const workspace = creditCardStore.getState().workspaces[BUDGET];
  const choices = statementChoices(card, workspace, [draft("2026-08-10", "2026-09-03"), draft("2026-09-10", "2026-10-03"), draft("2026-10-10", "2026-11-03")]);
  expect(choices.map((entry) => [entry.closingDate, entry.state])).toEqual([
    ["2026-10-10", "not-entered"], ["2026-09-10", "not-entered"], ["2026-08-10", "entered"],
  ]);
  expect(choices[2].statement?.id).toBe(saved.id);
  expect(suggestedChoice(choices)?.closingDate).toBe("2026-09-10");
});

it("flags an imported period that clearly belongs to another statement", () => {
  const statement = { periodStart: "2026-09-02", closingDate: "2026-10-01" };
  expect(periodMismatch(statement, { start: "2026-09-02", end: "2026-10-01" })).toBe(false);
  expect(periodMismatch(statement, { start: "2026-09-01", end: "2026-09-29" })).toBe(false);
  expect(periodMismatch(statement, { start: "2026-08-02", end: "2026-09-01" })).toBe(true);
  expect(periodMismatch(statement, { start: "2026-09-10", end: "2026-10-20" })).toBe(true);
});

it("chooses the statement in the figures dialog itself, checks its figures and reports the saved statement", async () => {
  const card = addCard(creditCardStore, CARD_INPUT);
  const saved = addStatement(creditCardStore, BUDGET, card.id, facts("2026-08-10", 1000));
  const onLinked = jest.fn();
  render(<CardStatementFigures connection={connection} card={card} cardName="Visa" onLinked={onLinked} onClose={jest.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "Card statement figures" });
  // One line per statement: closing date, period, balance and whether its figures are in.
  expect(within(dialog).getByLabelText("Statement")).toHaveTextContent(/10 Aug 2026 · .* – 10 Aug 2026 · 10\.00 · Entered/);
  expect(within(dialog).getByLabelText("Statement balance")).toHaveValue("10.00");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save figures" }));
  await waitFor(() => expect(onLinked).toHaveBeenCalledWith(saved.id));
});

it("reopens on the linked statement, and Skip saves nothing", () => {
  const card = addCard(creditCardStore, CARD_INPUT);
  const saved = addStatement(creditCardStore, BUDGET, card.id, facts("2026-08-10", 1000));
  const onClose = jest.fn();
  const { unmount } = render(<CardStatementFigures connection={connection} card={card} cardName="Visa" statementId={saved.id} onLinked={jest.fn()} onClose={onClose} />);
  // Re-editing a linked statement offers Cancel, not Skip.
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  unmount();
  render(<CardStatementFigures connection={connection} card={card} cardName="Visa" onLinked={jest.fn()} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(onClose).toHaveBeenCalled();
  expect(creditCardStore.getState().workspaces[BUDGET].statements.filter((entry) => !entry.estimate)).toHaveLength(1);
});

it("shows a waiting dialog until the card's activity is read", () => {
  const card = addCard(creditCardStore, CARD_INPUT);
  mockActivity.isPending = true;
  try {
    render(<CardStatementFigures connection={connection} card={card} cardName="Visa" onLinked={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading the card's activity");
  } finally {
    mockActivity.isPending = false;
  }
});

it("offers the linked statement's review after Apply, and nothing once it is gone", () => {
  const card = addCard(creditCardStore, CARD_INPUT);
  const saved = addStatement(creditCardStore, BUDGET, card.id, facts("2026-08-10", 1000));
  const { unmount } = render(<ReviewCardStatementLink statementId={saved.id} />);
  expect(screen.getByRole("link", { name: "Review statement 10 Aug 2026" }))
    .toHaveAttribute("href", cardStatementReviewHref(card.id, saved.id));
  expect(cardStatementReviewHref(card.id, saved.id)).toBe(`/credit-cards?card=${card.id}&tab=statements&review=${saved.id}`);
  unmount();
  render(<ReviewCardStatementLink statementId="deleted" />);
  expect(screen.queryByRole("region", { name: "Credit card statement" })).not.toBeInTheDocument();
});

it("asks before switching statements when figures were typed", () => {
  const card = addCard(creditCardStore, CARD_INPUT);
  addStatement(creditCardStore, BUDGET, card.id, facts("2026-08-10", 1000));
  addStatement(creditCardStore, BUDGET, card.id, facts("2026-09-10", 2000));
  render(<CardStatementFigures connection={connection} card={card} cardName="Visa" onLinked={jest.fn()} onClose={jest.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "Card statement figures" });
  const balance = within(dialog).getByLabelText("Statement balance");
  const before = (balance as HTMLInputElement).value;
  fireEvent.change(balance, { target: { value: "99.00" } });
  const select = within(dialog).getByRole("combobox", { name: "Statement" });
  const selected = select.textContent ?? "";
  fireEvent.click(select);
  const other = screen.getAllByRole("option").find((option) => option.textContent !== selected)!;
  fireEvent.pointerDown(other, { pointerType: "mouse", button: 0 });
  fireEvent.click(other, { detail: 1 });
  expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(within(dialog).getByLabelText("Statement balance")).not.toHaveValue("99.00");
  expect(before).not.toBe("99.00");
});

it("shows the header action: edit the linked statement, enter figures for a registered card, nothing otherwise", () => {
  const card = addCard(creditCardStore, CARD_INPUT);
  const saved = addStatement(creditCardStore, BUDGET, card.id, facts("2026-08-10", 1000));
  const onOpen = jest.fn();
  const { unmount } = render(<CardStatementHeaderAction statementId={saved.id} accountId={CARD_ACCOUNT}
    period={{ start: "2026-07-11", end: "2026-08-10" }} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "Card statement 10 Aug 2026: edit its figures" }));
  expect(onOpen).toHaveBeenCalled();
  unmount();
  const mismatch = render(<CardStatementHeaderAction statementId={saved.id} accountId={CARD_ACCOUNT} period={{ start: "2026-05-11", end: "2026-06-10" }} onOpen={onOpen} />);
  expect(screen.getByRole("button", { name: /Card statement 10 Aug 2026/ })).toHaveTextContent("different period?");
  mismatch.unmount();
  const skipped = render(<CardStatementHeaderAction statementId={null} accountId={CARD_ACCOUNT} onOpen={onOpen} />);
  expect(screen.getByRole("button", { name: /Enter card statement figures/ })).toBeInTheDocument();
  skipped.unmount();
  render(<CardStatementHeaderAction statementId={null} accountId="checking" onOpen={onOpen} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
