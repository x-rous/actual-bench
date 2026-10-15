import { asOfCardBalance, cardBalance, cardFacility, cardModel } from "./financialAdapter";
import { cardSchema } from "./models";
const card = cardSchema.parse({ id: "card", revision: 1, budgetSyncId: "budget", accountId: "account", nickname: "Example card", issuer: "", last4: "", creditLimitMinor: 100000, purchaseAprBps: null, bankTimeZone: "UTC", status: "active" });
it("uses signed future deltas consistently for current debt and card credit", () => {
  expect(asOfCardBalance(cardBalance(-150), -5000)).toMatchObject({ rawSignedBalanceMinor: -15000, signedBalanceMinor: -10000, debtMinor: 10000, creditMinor: 0 });
  expect(asOfCardBalance(cardBalance(25), 500)).toMatchObject({ signedBalanceMinor: 2000, debtMinor: 0, creditMinor: 2000 });
  expect(cardFacility(cardModel(card, "2026-10-14", 0), 2000).availableMinor).toBe(102000);
  expect(cardFacility(cardModel({ ...card, creditLimitMinor: null }, "2026-10-14", 0), 2000).availableMinor).toBeNull();
});
