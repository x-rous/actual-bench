import { limitOn } from "./derive/limits";
import { cardSchema, EMPTY_WORKSPACE, NEW_CARD_DEFAULTS } from "./models";

const card = cardSchema.parse({ ...NEW_CARD_DEFAULTS, id: "a", budgetSyncId: "b", accountId: "acc", revision: 1, bankTimeZone: "UTC", creditLimitMinor: 1500000 });
const workspace = {
  ...EMPTY_WORKSPACE,
  limitChanges: [
    { cardId: "a", effectiveDate: "2026-09-14", limitMinor: 4000000 },
    { cardId: "a", effectiveDate: "2026-03-02", limitMinor: 2500000 },
    { cardId: "a", effectiveDate: "2026-12-01", limitMinor: 3000000 },
    { cardId: "other", effectiveDate: "2026-01-01", limitMinor: 1 },
  ],
};

it("uses the latest change on or before a date, and the starting limit before any change", () => {
  expect(limitOn(card, workspace, "2026-03-01")).toBe(1500000);
  expect(limitOn(card, workspace, "2026-03-02")).toBe(2500000);
  expect(limitOn(card, workspace, "2026-09-13")).toBe(2500000);
  // Mid-month: from the effective day, not from a statement.
  expect(limitOn(card, workspace, "2026-09-14")).toBe(4000000);
  expect(limitOn(card, workspace, "2026-10-19")).toBe(4000000);
  // A future decrease applies only from its date.
  expect(limitOn(card, workspace, "2026-12-01")).toBe(3000000);
  expect(limitOn({ ...card, creditLimitMinor: null }, EMPTY_WORKSPACE, "2026-10-19")).toBeNull();
});
