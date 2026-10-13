import { fireEvent, render, screen, within } from "@testing-library/react";
import { CardEditor } from "./CardEditors";
import { creditCardStore } from "../lib/memory";

it("retains category mappings and an explicit Off choice when category loading fails", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "Bank", last4: "1234", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active", interestCategoryId: "saved-interest", feeCategoryId: "saved-fees", interestModel: "off" });
  const retry = jest.fn();
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[{ id: "card", name: "Actual Visa", offBudget: false, closed: false }]} categoriesError onRetryCategories={retry} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "Card settings" });
  fireEvent.click(within(dialog).getByText("More card details"));
  expect(within(dialog).getByLabelText("Interest category in Actual")).toBeDisabled();
  expect(within(dialog).getByLabelText("Fees category in Actual")).toHaveTextContent("Saved category (unavailable)");
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry categories" }));
  expect(retry).toHaveBeenCalledTimes(1);
  fireEvent.change(within(dialog).getByLabelText("Nickname"), { target: { value: "Updated Visa" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0]).toMatchObject({ nickname: "Updated Visa", interestCategoryId: "saved-interest", feeCategoryId: "saved-fees", interestModel: "off" });
});

it("shows and accepts named-month card dates while saving ISO dates", () => {
  creditCardStore.setState({ workspaces: {}, undoHistory: {}, notices: {} });
  const card = creditCardStore.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Visa", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active", openedDate: "2026-09-01", renewalDate: "2026-10-24" });
  render(<CardEditor budgetSyncId="budget" card={card} accounts={[]} canRegister onClose={jest.fn()} onSaved={jest.fn()} />);
  fireEvent.click(screen.getByText("More card details"));
  expect(screen.getByLabelText("Date opened")).toHaveValue("01 Sep 2026");
  const renewal = screen.getByLabelText("Fee renewal date");
  expect(renewal).toHaveValue("24 Oct 2026");
  fireEvent.change(renewal, { target: { value: "25 Nov 2026" } });
  fireEvent.blur(renewal);
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
  expect(creditCardStore.getState().workspaces.budget.cards[0].renewalDate).toBe("2026-11-25");
});
