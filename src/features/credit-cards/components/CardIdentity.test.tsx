import { render } from "@testing-library/react";
import { CardMark } from "./CardIdentity";
import { createCreditCardStore } from "../lib/memory";

it("renders saved preset/custom colours and follows card-setting updates", () => {
  const store = createCreditCardStore();
  const card = store.getState().register({ budgetSyncId: "budget", accountId: "card", nickname: "Card", issuer: "", last4: "", creditLimitMinor: null, purchaseAprBps: null, bankTimeZone: "UTC", status: "active", appearance: "red" });
  const { container, rerender } = render(<CardMark card={card} />);
  expect(container.firstChild).toHaveStyle({ backgroundColor: "#991b1b" });
  const { id, revision, ...input } = card;
  store.getState().updateCard("budget", id, revision, { ...input, appearance: "blue", customColor: "#123456" });
  rerender(<CardMark card={store.getState().workspaces.budget.cards[0]} />);
  expect(container.firstChild).toHaveStyle({ backgroundColor: "#123456" });
});
