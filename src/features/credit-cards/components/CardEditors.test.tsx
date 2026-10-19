import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { CardEditor, StatementEditor } from "./CardEditors";
import { creditCardStore } from "../lib/store/store";
import { resetCreditCardStore, addCard, addStatement } from "../lib/fixtures/testKit";

it("keeps the delete confirmation open and reports stale saved data without deleting it", () => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC" });
  const close = jest.fn();
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={close} onSaved={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete card" }));
  const { id, revision, ...input } = card;
  creditCardStore.getState().updateCard("budget", id, revision, { ...input, creditLimitMinor: 1 });
  const confirmation = screen.getByRole("dialog", { name: "Delete credit card?" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "Delete card" }));
  expect(within(confirmation).getByRole("alert")).toHaveTextContent("This record changed");
  expect(creditCardStore.getState().workspaces.budget.cards[0].creditLimitMinor).toBe(1);
  expect(close).not.toHaveBeenCalled();
});

it("creates cards in the sectioned settings drawer with the default billing rules", () => {
  resetCreditCardStore();
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Card", offBudget: false, closed: false }]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByRole("dialog", { name: "Add credit card" })).toHaveAttribute("data-slot", "sheet-content");
  for (const section of ["Essentials", "Billing", "Categories in Actual", "Minimum and interest estimates", "Appearance", "More"]) expect(screen.getByRole("group", { name: section })).toBeVisible();
  // Three fields per row: the account, limit and APR lead; the first tracked statement sits in Essentials.
  const essentials = screen.getByRole("group", { name: "Essentials" });
  for (const label of ["Actual account", "Credit limit (optional)", "Purchase APR % (optional)", "First tracked statement"]) {
    expect(within(essentials).getByLabelText(label)).toBeInTheDocument();
  }
  expect(within(screen.getByRole("group", { name: "Minimum and interest estimates" })).getByLabelText("Day count")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^More about / }).length).toBeLessThanOrEqual(6);
  expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete card" })).not.toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: /Statement closing day/ })).toHaveValue(10);
  expect(screen.getByRole("combobox", { name: "Due date rule" })).toHaveTextContent("Day of month");
  expect(screen.getByRole("spinbutton", { name: "Payment due day" })).toHaveValue(3);
  expect(screen.queryByText(/replaces these days/)).not.toBeInTheDocument();
  expect(screen.getByRole("figure", { name: "Billing cycle preview" })).toBeVisible();
  expect(screen.queryByText(/^Next cycle:/)).not.toBeInTheDocument();
  // The loan calculator's day-count names.
  expect(screen.getByLabelText("Day count")).toHaveTextContent("Actual/365 Fixed");
  expect(screen.queryByText(/^Next: closes /)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0]).toMatchObject({ closingDay: 10, dueRule: { kind: "day-of-month", value: 3 }, billingDaysSource: "default" });
});

it.each([
  ["visa", "Visa"], ["mastercard", "Mastercard"], ["amex", "American Express"],
  ["discover", "Discover"], ["jcb", "JCB"], ["unionpay", "UnionPay"], ["diners-club", "Diners Club"],
] as const)("selects and saves the %s network with a local icon", async (network, label) => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC", closingDay: 7 });
  const onSaved = jest.fn();
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={jest.fn()} onSaved={onSaved} />);
  const select = screen.getByRole("combobox", { name: "Network" });
  fireEvent.click(select);
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Not set", "Visa", "Mastercard", "American Express", "Discover", "JCB", "UnionPay", "Diners Club", "Other",
  ]);
  const option = screen.getByRole("option", { name: label });
  expect(option.querySelector("img")).toHaveAttribute("src", `/payment-networks/${network}.svg`);
  fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
  fireEvent.click(option, { detail: 1 });
  await waitFor(() => expect(select).toHaveTextContent(label));
  expect(select.querySelector("img")).toHaveAttribute("alt", "");
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(card.id));
  expect(creditCardStore.getState().workspaces.budget.cards[0].network).toBe(network);
});

it("retains category mappings and an explicit Off choice when category loading fails", async () => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC", interestCategoryId: "saved-interest", feeCategoryId: "saved-fees", cashbackCategoryId: "saved-cashback", interestModel: "off", closingDay: 7, dueRule: { kind: "day-of-month", value: 1 } });
  const retry = jest.fn();
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[{ id: "card", name: "Actual Visa", offBudget: false, closed: false }]} categoriesError onRetryCategories={retry} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "Card settings" });
  expect(within(dialog).getByRole("spinbutton", { name: /Statement closing day/ })).toHaveValue(7);
  expect(within(dialog).getByRole("spinbutton", { name: "Payment due day" })).toHaveValue(1);
  expect(within(dialog).getByLabelText("Interest category in Actual")).toBeDisabled();
  expect(within(dialog).getByLabelText("Cashback category in Actual")).toBeDisabled();
  expect(within(dialog).getByLabelText("Cashback category in Actual")).toHaveTextContent("Saved category (unavailable)");
  expect(within(dialog).getByLabelText("Fees category in Actual")).toHaveTextContent("Saved category (unavailable)");
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry categories" }));
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  fireEvent.change(within(dialog).getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0]).toMatchObject({ interestCategoryId: "saved-interest", feeCategoryId: "saved-fees", cashbackCategoryId: "saved-cashback", interestModel: "off", closingDay: 31, billingDaysSource: "user", dueRule: { kind: "day-of-month", value: 1 } });
});

it("shows and accepts named-month card dates while saving ISO dates", () => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC", openedDate: "2026-09-01", annualFeeRenewalDate: "2026-10-24" });
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByLabelText("Date opened")).toHaveValue("01 Sep 2026");
  const renewal = screen.getByLabelText("Fee renewal date");
  expect(renewal).toHaveValue("24 Oct 2026");
  fireEvent.change(renewal, { target: { value: "25 Nov 2026" } });
  fireEvent.blur(renewal);
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0].annualFeeRenewalDate).toBe("2026-11-25");
});


it.each([["", null], ["0", 0], ["-12.34", -1234]])("saves an optional signed previous balance when the previous statement is missing (%s)", (value, expected) => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC" });
  const suggested = { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", balanceMinor: 10000, minimumDueMinor: 1000, amountDueMinor: null, previousBalanceMinor: null, minimumKnown: true };
  render(<StatementEditor budgetSyncId="budget" card={card} cardName="Card" suggested={suggested} previousMissing canRecord onClose={jest.fn()} />);
  expect(screen.getAllByText("Pre-filled from Actual - check each marked value against your statement")).toHaveLength(1);
  expect(screen.getAllByText("(pre-filled from Actual)").length).toBeGreaterThan(1);
  fireEvent.change(screen.getByLabelText("Previous balance (optional)"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save statement" }));
  expect(creditCardStore.getState().workspaces.budget.statements[0]).toMatchObject({ previousBalanceMinor: expected });
});

it("does not ask for a previous balance when the previous statement is saved, and caps the amount due", () => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC", firstTrackedStatementDate: "2026-09-30" });
  const suggested = { periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-20", balanceMinor: 10000, minimumDueMinor: 1000, amountDueMinor: null, previousBalanceMinor: null, minimumKnown: true };
  render(<StatementEditor budgetSyncId="budget" card={card} cardName="Card" suggested={suggested} previousMissing={false} canRecord onClose={jest.fn()} />);
  expect(screen.queryByLabelText("Previous balance (optional)")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Amount due (optional)"), { target: { value: "9,999.99" } });
  fireEvent.click(screen.getByRole("button", { name: "Save statement" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Amount due cannot exceed the statement balance");
});

it("rejects a thousands-grouped APR as a percentage (CA-17)", () => {
  resetCreditCardStore();
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Card", offBudget: false, closed: false }]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Purchase APR % (optional)"), { target: { value: "1,000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(screen.getByRole("alert")).toHaveTextContent("percentage");
  fireEvent.change(screen.getByLabelText("Purchase APR % (optional)"), { target: { value: "24.99" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0].purchaseAprBps).toBe(2499);
});

it("uses account identity, offers only Active/Inactive and puts guidance in field popovers", async () => {
  resetCreditCardStore();
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Actual card account", offBudget: false, closed: false }]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByLabelText("Actual account")).toBeVisible();
  expect(screen.getByLabelText("First tracked statement")).toBeVisible();
  const help = screen.getByRole("button", { name: "More about First tracked statement" });
  fireEvent.focus(help);
  await waitFor(() => expect(screen.getByText(/Closing date of the first statement to track/)).toBeVisible());
  fireEvent.blur(help);
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  expect(screen.getByLabelText("Minimum payment %")).toHaveValue("5");
  expect(screen.getByLabelText("Minimum payment floor")).toHaveValue("100.00");
  expect(screen.queryByRole("button", { name: "More card details" })).not.toBeInTheDocument();
  for (const name of ["Nickname", "Issuer (optional)", "Last four digits (optional)"]) expect(screen.queryByLabelText(name)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Cash advance APR %")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Balance transfer APR %")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("combobox", { name: "Card status" }));
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Active", "Inactive"]);
  const inactive = screen.getByRole("option", { name: "Inactive" });
  fireEvent.pointerDown(inactive, { pointerType: "mouse", button: 0 });
  fireEvent.click(inactive, { detail: 1 });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Card status" })).toHaveTextContent("Inactive"));
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0]).toMatchObject({ status: "inactive", minimumPercentBps: 500, minimumFloorMinor: 10000 });
});


it("preserves existing minimum settings instead of replacing them with new-card defaults", () => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC", minimumPercentBps: 200, minimumFloorMinor: 2500 });
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByLabelText("Minimum payment %")).toHaveValue("2");
  expect(screen.getByLabelText("Minimum payment floor")).toHaveValue("25.00");
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0]).toMatchObject({ minimumPercentBps: 200, minimumFloorMinor: 2500 });
});

it("edits bank values without requesting or storing a correction note", async () => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC" });
  const statement = addStatement(creditCardStore, "budget", card.id, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", balanceMinor: 10000, minimumDueMinor: 1000 });
  const onSaved = jest.fn();
  render(<StatementEditor budgetSyncId="budget" card={card} cardName="Card" statement={statement} previousMissing canRecord onClose={jest.fn()} onSaved={onSaved} />);
  expect(screen.queryByLabelText("Correction reason")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Statement balance"), { target: { value: "125.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(statement.id));
  expect(creditCardStore.getState().workspaces.budget.statements[0].balanceMinor).toBe(12500);
  expect(creditCardStore.getState().workspaces.budget).not.toHaveProperty("corrections");
});

it("saves a selected cashback category from the Actual category directory", async () => {
  resetCreditCardStore();
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Card", offBudget: false, closed: false }]} categories={[{ id: "rewards", name: "Card rewards" }]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Cashback category in Actual" }));
  const choice = screen.getByRole("option", { name: "Card rewards" });
  fireEvent.pointerDown(choice, { pointerType: "mouse", button: 0 });
  fireEvent.click(choice, { detail: 1 });
  await waitFor(() => expect(screen.getByRole("button", { name: "Cashback category in Actual" })).toHaveTextContent("Card rewards"));
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0].cashbackCategoryId).toBe("rewards");
});

it("keeps drawer fields unsaved until Save card", async () => {
  resetCreditCardStore();
  const saved = jest.fn();
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Example card", offBudget: false, closed: false }]} canRegister onClose={jest.fn()} onSaved={saved} />);
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  expect(saved).not.toHaveBeenCalled();
  expect(creditCardStore.getState().workspaces.budget).toBeUndefined();
  expect(screen.getByRole("button", { name: "Save card" })).toBeVisible();
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
});

it("keeps an invalid tracking date unsaved in the drawer until corrected", async () => {
  resetCreditCardStore();
  const saved = jest.fn();
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Example card", offBudget: false, closed: false }]} canRegister onClose={jest.fn()} onSaved={saved} />);
  const date = screen.getByLabelText("First tracked statement");
  fireEvent.change(date, { target: { value: "31 Feb 2026" } });
  fireEvent.blur(date);
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Correct the invalid date before saving");
  expect(date).toHaveValue("31 Feb 2026");
  expect(saved).not.toHaveBeenCalled();
  expect(creditCardStore.getState().workspaces.budget).toBeUndefined();
  fireEvent.change(date, { target: { value: "28 Feb 2026" } });
  fireEvent.blur(date);
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(creditCardStore.getState().workspaces.budget.cards[0].firstTrackedStatementDate).toBe("2026-02-28");
});

it("asks before discarding a changed card draft and keeps it when editing continues", async () => {
  resetCreditCardStore();
  const close = jest.fn();
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Example card", offBudget: false, closed: false }]} canRegister onClose={close} onSaved={jest.fn()} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: /Statement closing day/ }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("spinbutton", { name: /Statement closing day/ })).toHaveValue(31);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

it("updates the visual billing timeline when closing and due inputs change", async () => {
  resetCreditCardStore();
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Example card", offBudget: false, closed: false }]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByRole("figure", { name: "Billing cycle preview" })).toBeVisible();
  fireEvent.change(screen.getByRole("spinbutton", { name: /Statement closing day/ }), { target: { value: "7" } });
  const preview = screen.getByRole("figure", { name: "Billing cycle preview" });
  expect(preview.querySelector("svg")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("combobox", { name: "Due date rule" }));
  const rule = screen.getByRole("option", { name: "Days after closing" });
  fireEvent.pointerDown(rule, { pointerType: "mouse", button: 0 });
  fireEvent.click(rule, { detail: 1 });
  await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Days until payment due" })).toBeVisible());
  fireEvent.change(screen.getByRole("spinbutton", { name: "Days until payment due" }), { target: { value: "21" } });
  expect(preview).toHaveTextContent("21 days to pay");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Days until payment due" }), { target: { value: "0" } });
  expect(preview).toHaveTextContent("0 days to pay");
  const sameDayMarker = preview.querySelector('line[stroke-width="2"]')!;
  const closingMarker = preview.querySelectorAll("line")[1];
  expect(sameDayMarker.getAttribute("x1")).toBe(closingMarker.getAttribute("x1"));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Days until payment due" }), { target: { value: "90" } });
  expect(preview).toHaveTextContent("90 days to pay");
  expect(Number(preview.querySelector('line[stroke-width="2"]')!.getAttribute("x1"))).toBeLessThanOrEqual(592);
  fireEvent.change(screen.getByRole("spinbutton", { name: /Statement closing day/ }), { target: { value: "32" } });
  expect(screen.queryByRole("figure", { name: "Billing cycle preview" })).not.toBeInTheDocument();
});

it("asks about plan accounts in a Plans section: Yes when the card already moves money to one, with its transfers counted", async () => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC" });
  const onSaved = jest.fn();
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={jest.fn()} onSaved={onSaved} planAccounts={{
    registered: [{ id: "plans", name: "Plan loans", usedBy: ["Laptop"], transfers: { card: 18, other: 4 } }],
    available: [{ id: "plans", name: "Plan loans" }, { id: "other", name: "Other loans" }],
  }} />);
  expect(screen.getByRole("radio", { name: "Yes" })).toHaveAttribute("aria-checked", "true");
  const list = screen.getByRole("list", { name: "Plan accounts" });
  expect(list).toHaveTextContent("Plan loans");
  expect(screen.getByText("Plan loans: 18 transfers with this card · used by Laptop")).toBeVisible();
  expect(within(list).queryByRole("button", { name: /Remove plan account/ })).not.toBeInTheDocument();
  const add = screen.getByLabelText("Add plan account");
  fireEvent.click(add);
  const option = await screen.findByRole("option", { name: "Other loans" });
  fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
  fireEvent.click(option, { detail: 1 });
  expect(screen.getByRole("list", { name: "Plan accounts" })).toHaveTextContent("Other loans");
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(creditCardStore.getState().workspaces.budget.planAccounts).toEqual(["plans", "other"]);
});

it("hides plan accounts behind No, and saving No clears the plan-balances setting without unregistering accounts", async () => {
  resetCreditCardStore();
  creditCardStore.getState().setPlanAccounts("budget", ["shared"]);
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC", statementsIncludePlanBalances: true });
  const onSaved = jest.fn();
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={jest.fn()} onSaved={onSaved} planAccounts={{
    registered: [{ id: "shared", name: "Credit card loans", usedBy: [], transfers: null }],
    available: [{ id: "shared", name: "Credit card loans" }],
  }} />);
  const plans = screen.getByRole("group", { name: "Instalment plans" });
  expect(within(plans).getByLabelText("Statement balance includes plan balances")).toBeChecked();
  expect(within(plans).getByText("Credit card loans: read after saving")).toBeVisible();
  fireEvent.click(within(plans).getByRole("radio", { name: "No" }));
  expect(within(plans).queryByRole("list", { name: "Plan accounts" })).not.toBeInTheDocument();
  expect(within(plans).queryByLabelText("Statement balance includes plan balances")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(creditCardStore.getState().workspaces.budget.cards[0].statementsIncludePlanBalances).toBe(false);
  expect(creditCardStore.getState().workspaces.budget.planAccounts).toEqual(["shared"]);
});

it("offers the Plans question when adding a card, and registers the chosen plan account with the new card", async () => {
  resetCreditCardStore();
  const onSaved = jest.fn();
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Card", offBudget: false, closed: false }]} canRegister onClose={jest.fn()}
    onSaved={onSaved} planAccounts={{ registered: [], available: [{ id: "loans", name: "Credit card loans" }] }} />);
  const plans = screen.getByRole("group", { name: "Instalment plans" });
  expect(within(plans).getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(within(plans).getByRole("radio", { name: "Yes" }));
  fireEvent.click(within(plans).getByLabelText("Add plan account"));
  const option = await screen.findByRole("option", { name: "Credit card loans" });
  fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
  fireEvent.click(option, { detail: 1 });
  fireEvent.click(within(plans).getByLabelText("Statement balance includes plan balances"));
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const saved = creditCardStore.getState().workspaces.budget;
  expect(saved.planAccounts).toEqual(["loans"]);
  expect(saved.cards[0].statementsIncludePlanBalances).toBe(true);
});

it("records limit changes in Settings: the field turns read-only with the limit today, and removing them makes it editable again", async () => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC", creditLimitMinor: 1500000 });
  const onSaved = jest.fn();
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={jest.fn()} onSaved={onSaved} />);
  expect(screen.getByLabelText("Credit limit (optional)")).toHaveValue("15000.00");
  fireEvent.click(screen.getByRole("button", { name: "Record a limit change" }));
  const dialog = screen.getByRole("dialog", { name: "Record a limit change" });
  fireEvent.change(within(dialog).getByLabelText("Effective date"), { target: { value: "14 Sep 2025" } });
  fireEvent.blur(within(dialog).getByLabelText("Effective date"));
  fireEvent.change(within(dialog).getByLabelText("New limit"), { target: { value: "40,000.00" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add change" }));
  const history = within(dialog).getByRole("list", { name: "Limit history" });
  expect(history).toHaveTextContent("14 Sep 2025");
  expect(history).toHaveTextContent("40,000.00");
  expect(history).toHaveTextContent("Starting limit15,000.00");
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  const current = screen.getByLabelText("Current credit limit");
  expect(current).toHaveValue("40000.00");
  expect(current).toHaveAttribute("readonly");
  expect(screen.getByText("since 14 Sep 2025")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const saved = creditCardStore.getState().workspaces.budget;
  expect(saved.limitChanges).toEqual([{ cardId: card.id, effectiveDate: "2025-09-14", limitMinor: 4000000 }]);
  expect(saved.cards[0].creditLimitMinor).toBe(1500000);
});

it("makes the Credit limit field editable again once every change is removed", () => {
  resetCreditCardStore();
  const card = addCard(creditCardStore, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC", creditLimitMinor: 1500000 });
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={jest.fn()} onSaved={jest.fn()}
    limitChanges={[{ cardId: card.id, effectiveDate: "2025-09-14", limitMinor: 4000000 }]} />);
  expect(screen.getByLabelText("Current credit limit")).toHaveAttribute("readonly");
  fireEvent.click(screen.getByRole("button", { name: "Record a limit change" }));
  const dialog = screen.getByRole("dialog", { name: "Record a limit change" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove the change on 14 Sep 2025" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(screen.getByLabelText("Credit limit (optional)")).not.toHaveAttribute("readonly");
});
