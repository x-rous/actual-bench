import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { CardEditor, StatementEditor } from "./CardEditors";
import { creditCardStore } from "../lib/memory";

it("retains category mappings and an explicit Off choice when category loading fails", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "Bank", last4: "1234", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active", interestCategoryId: "saved-interest", feeCategoryId: "saved-fees", cashbackCategoryId: "saved-cashback", interestModel: "off" });
  const retry = jest.fn();
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[{ id: "card", name: "Actual Visa", offBudget: false, closed: false }]} categoriesError onRetryCategories={retry} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "Card settings" });
  expect(within(dialog).getByLabelText("Interest category in Actual")).toBeDisabled();
  expect(within(dialog).getByLabelText("Cashback category in Actual")).toBeDisabled();
  expect(within(dialog).getByLabelText("Cashback category in Actual")).toHaveTextContent("Saved category (unavailable)");
  expect(within(dialog).getByLabelText("Fees category in Actual")).toHaveTextContent("Saved category (unavailable)");
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry categories" }));
  expect(retry).toHaveBeenCalledTimes(1);
  fireEvent.change(within(dialog).getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0]).toMatchObject({ nickname: "Actual Visa", interestCategoryId: "saved-interest", feeCategoryId: "saved-fees", cashbackCategoryId: "saved-cashback", interestModel: "off" });
});

it("shows and accepts named-month card dates while saving ISO dates", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active", openedDate: "2026-09-01", renewalDate: "2026-10-24" });
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByLabelText("Date opened")).toHaveValue("01 Sep 2026");
  const renewal = screen.getByLabelText("Fee renewal date");
  expect(renewal).toHaveValue("24 Oct 2026");
  fireEvent.change(renewal, { target: { value: "25 Nov 2026" } });
  fireEvent.blur(renewal);
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0].renewalDate).toBe("2026-11-25");
});


it.each([["", null], ["0", 0], ["-12.34", -1234]])("saves an optional signed first-cycle opening balance (%s)", (value, expected) => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  render(<StatementEditor budgetSyncId="budget" card={card} suggested={{ periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000, bankConfirmed: false, minimumKnown: true }} canRecord onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Balance brought forward (optional)"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save statement" }));
  expect(creditCardStore.getState().workspaces.budget.statements[0]).toMatchObject({ openingAnchor: true, openingBalanceMinor: expected });
});

it("does not ask for a brought-forward balance on subsequent statements", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active", firstTrackedStatementDate: "2026-09-30" });
  render(<StatementEditor budgetSyncId="budget" card={card} suggested={{ periodStart: "2026-10-01", closingDate: "2026-10-31", dueDate: "2026-11-20", officialBalanceMinor: 10000, minimumDueMinor: 1000, bankConfirmed: false, minimumKnown: true }} canRecord onClose={jest.fn()} />);
  expect(screen.queryByLabelText("Balance brought forward (optional)")).not.toBeInTheDocument();
});

it("uses account identity, offers only Active/Inactive and puts guidance in field popovers", async () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Actual card account", offBudget: false, closed: false }]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByLabelText("Actual account")).toBeVisible();
  expect(screen.getByLabelText("First tracked statement")).toBeVisible();
  const help = screen.getByRole("button", { name: "About First tracked statement" });
  fireEvent.click(help);
  await waitFor(() => expect(screen.getByText(/All history from this statement loads automatically/)).toBeVisible());
  fireEvent.click(help);
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "More details" }));
  expect(screen.getByLabelText("Minimum payment %")).toHaveValue("5.00");
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
  expect(creditCardStore.getState().workspaces.budget.cards[0]).toMatchObject({ nickname: "Actual card account", issuer: "", last4: "", status: "inactive", cashAdvanceAprBps: null, balanceTransferAprBps: null, minimumPercentBps: 500, minimumFloorMinor: 10000 });
});


it("preserves existing minimum settings instead of replacing them with new-card defaults", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active", minimumPercentBps: 200, minimumFloorMinor: 2500 });
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByLabelText("Minimum payment %")).toHaveValue("2.00");
  expect(screen.getByLabelText("Minimum payment floor")).toHaveValue("25.00");
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0]).toMatchObject({ minimumPercentBps: 200, minimumFloorMinor: 2500 });
});

it("edits bank values without requesting or storing a correction note", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
  const statement = creditCardStore.getState().recordOpeningStatement("budget", card.id, card.revision, { periodStart: "2026-09-01", closingDate: "2026-09-30", dueDate: "2026-10-20", officialBalanceMinor: 10000, minimumDueMinor: 1000 });
  const onSaved = jest.fn();
  render(<StatementEditor budgetSyncId="budget" card={card} statement={statement} canRecord onClose={jest.fn()} onSaved={onSaved} />);
  expect(screen.queryByLabelText("Correction reason")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Statement balance"), { target: { value: "125.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
  expect(onSaved).toHaveBeenCalledWith(statement.id);
  expect(creditCardStore.getState().workspaces.budget.statements[0].officialBalanceMinor).toBe(12500);
  expect(creditCardStore.getState().workspaces.budget).not.toHaveProperty("corrections");
});

it("saves a selected cashback category from the Actual category directory", async () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Card", offBudget: false, closed: false }]} categories={[{ id: "rewards", name: "Card rewards" }]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("combobox", { name: "Cashback category in Actual" }));
  const choice = screen.getByRole("option", { name: "Card rewards" });
  fireEvent.pointerDown(choice, { pointerType: "mouse", button: 0 });
  fireEvent.click(choice, { detail: 1 });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Cashback category in Actual" })).toHaveTextContent("Card rewards"));
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0].cashbackCategoryId).toBe("rewards");
});

it("keeps setup unsaved after Continue and only records the card on Save card", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const saved = jest.fn();
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Example card", offBudget: false, closed: false }]} canRegister onClose={jest.fn()} onSaved={saved} />);
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(saved).not.toHaveBeenCalled();
  expect(creditCardStore.getState().workspaces.budget).toBeUndefined();
  expect(screen.getByRole("button", { name: "Save card" })).toBeVisible();
  if (screen.queryByLabelText(/Statement closing day/, { selector: "input" })) fireEvent.change(screen.getByLabelText(/Statement closing day/, { selector: "input" }), { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(saved).toHaveBeenCalledTimes(1);
});

it("retains an invalid tracking date on the first setup step until corrected", async () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Example card", offBudget: false, closed: false }]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: /Statement closing day/ }), { target: { value: "31" } });
  const date = screen.getByLabelText("First tracked statement");
  fireEvent.change(date, { target: { value: "31 Feb 2026" } });
  fireEvent.blur(date);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("button", { name: "Continue" })).toBeVisible();
  expect(date).toHaveValue("31 Feb 2026");
  expect(creditCardStore.getState().workspaces.budget).toBeUndefined();
  fireEvent.change(date, { target: { value: "28 Feb 2026" } });
  fireEvent.blur(date);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("button", { name: "Save card" })).toBeVisible();
});

it("asks before discarding a changed card draft and keeps it when editing continues", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
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
  expect(close).toHaveBeenCalledTimes(1);
});

it("updates the visual billing timeline when closing and due inputs change", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  render(<CardEditor budgetSyncId="budget" accounts={[{ id: "card", name: "Example card", offBudget: false, closed: false }]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.queryByRole("figure", { name: "Billing cycle preview" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: /Statement closing day/ }), { target: { value: "7" } });
  const preview = screen.getByRole("figure", { name: "Billing cycle preview" });
  expect(preview.querySelector("svg")).toBeInTheDocument();
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
