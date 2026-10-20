import { render } from "@testing-library/react";
import { CardMark } from "./CardIdentity";
import { createCreditCardStore } from "../lib/store/store";
import { addCard } from "../lib/fixtures/testKit";

it.each([false, true])("renders saved colours and embedded network marks, following setting updates (preview: %s)", (preview) => {
  const store = createCreditCardStore();
  const card = addCard(store, { budgetSyncId: "budget", accountId: "card", bankTimeZone: "UTC", color: "#991b1b", network: "mastercard" });
  const { container, rerender } = render(<CardMark card={card} preview={preview} />);
  expect(container.firstChild).toHaveStyle({ backgroundColor: "#991b1b" });
  expect(container.firstChild).toHaveAccessibleName("Mastercard card");
  expect(container.querySelector("img")).toHaveAttribute("src", "/payment-networks/marks/mastercard.svg");
  const { id, revision, ...input } = card;
  store.getState().updateCard("budget", id, revision, { ...input, color: "#123456", network: "visa" });
  rerender(<CardMark card={store.getState().workspaces.budget.cards[0]} preview={preview} />);
  expect(container.firstChild).toHaveStyle({ backgroundColor: "#123456" });
  expect(container.querySelector("img")).toHaveAttribute("src", "/payment-networks/marks/visa.svg");
});
