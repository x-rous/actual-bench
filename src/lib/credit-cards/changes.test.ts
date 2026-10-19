import { applyChangeSet, CreditCardConflictError, CreditCardRuleError, diffWorkspaces, EMPTY_CHANGES, inverseChanges, isEmptyChangeSet } from "./changes";
import { EMPTY_WORKSPACE } from "./schema";
import { BUDGET, CARD_INPUT, laptopPlanScenario, setup, facts } from "@/features/credit-cards/lib/fixtures/testKit";

it("diffs nothing for equal workspaces and applies a diff back to the target", () => {
  const { workspace } = laptopPlanScenario();
  const after = workspace();
  expect(isEmptyChangeSet(diffWorkspaces(after, after))).toBe(true);
  expect(applyChangeSet(EMPTY_WORKSPACE, diffWorkspaces(EMPTY_WORKSPACE, after), BUDGET)).toEqual(after);
});

it("undoes a committed change and raises restored revisions so old editors stay stale (ABA)", () => {
  const { store, workspace, card } = setup({}, [facts("2026-02-10", 0), facts("2026-03-10", 500)]);
  const before = workspace();
  store.getState().deleteCard(BUDGET, card().id, card().revision);
  const after = workspace();
  const undone = applyChangeSet(after, inverseChanges(before, after), BUDGET);
  expect(undone.statements.map((row) => row.closingDate)).toEqual(["2026-02-10", "2026-03-10"]);
  expect(undone.cards[0].revision).toBeGreaterThan(before.cards[0].revision);
  expect(() => applyChangeSet(undone, { ...EMPTY_CHANGES, cards: { put: [], remove: [{ id: before.cards[0].id, revision: before.cards[0].revision }] } }, BUDGET))
    .toThrow(CreditCardConflictError);
});

it("refuses an undo when the row changed since", () => {
  const { store, workspace, card } = setup();
  const before = workspace();
  store.getState().updateCard(BUDGET, card().id, card().revision, { ...CARD_INPUT, creditLimitMinor: 1 });
  const after = workspace();
  const elsewhere = applyChangeSet(after, diffWorkspaces(after, { ...after, cards: [{ ...after.cards[0], creditLimitMinor: 2, revision: after.cards[0].revision + 1 }] }), BUDGET);
  expect(() => applyChangeSet(elsewhere, inverseChanges(before, after), BUDGET)).toThrow(CreditCardConflictError);
});

it("moves child rows only with their parent and keeps used plan accounts", () => {
  const { workspace } = laptopPlanScenario();
  const current = workspace();
  const statement = current.statements[0];
  const decisions = [{ statementId: statement.id, rows: [] }];
  expect(() => applyChangeSet(current, { ...EMPTY_CHANGES, decisions }, BUDGET)).toThrow(CreditCardRuleError);
  expect(() => applyChangeSet(current, { ...EMPTY_CHANGES, planEntries: [{ planId: "plan", rows: [] }] }, BUDGET)).toThrow(CreditCardRuleError);
  expect(() => applyChangeSet(current, { ...EMPTY_CHANGES, planAccounts: { expected: current.planAccounts, next: [] } }, BUDGET))
    .toThrow("A plan still uses this plan account");
  expect(() => applyChangeSet(current, { ...EMPTY_CHANGES, planAccounts: { expected: [], next: [] } }, BUDGET)).toThrow(CreditCardConflictError);
});
