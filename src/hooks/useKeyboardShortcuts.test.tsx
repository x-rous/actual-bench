import { act, fireEvent, renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useStagedStore } from "@/store/staged";
import { useBudgetEditsStore } from "@/store/budgetEdits";

let mockPathname = "/credit-cards";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));

beforeEach(() => {
  mockPathname = "/credit-cards";
  useStagedStore.getState().discardAll();
  useBudgetEditsStore.getState().discardAll();
});
afterEach(() => {
  useStagedStore.getState().discardAll();
  useBudgetEditsStore.getState().discardAll();
});

function stageHolds() {
  const store = useBudgetEditsStore.getState();
  store.stageHold({ month: "2026-10", nextAmount: 100, previousAmount: 0 });
  store.stageHold({ month: "2026-11", nextAmount: 200, previousAmount: 0 });
}
function stagePayee() {
  const store = useStagedStore.getState();
  store.pushUndo();
  store.stageNew("payees", { id: "draft-payee", name: "Draft payee" });
}

it.each(["/credit-cards", "/reconciliation", "/loans/new", "/budget-management"])("routes undo and redo to budget drafts on %s", path => {
  mockPathname = path;
  stageHolds();
  renderHook(() => useKeyboardShortcuts());
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  expect(Object.keys(useBudgetEditsStore.getState().holds)).toHaveLength(1);
  fireEvent.keyDown(document.body, { key: "z", metaKey: true, shiftKey: true });
  expect(Object.keys(useBudgetEditsStore.getState().holds)).toHaveLength(2);
});

it("resolves entities first when both draft owners block entry, then switches to budget undo", () => {
  stageHolds();
  stagePayee();
  renderHook(() => useKeyboardShortcuts());
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  expect(useStagedStore.getState().payees["draft-payee"]).toBeUndefined();
  expect(Object.keys(useBudgetEditsStore.getState().holds)).toHaveLength(2);
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  expect(Object.keys(useBudgetEditsStore.getState().holds)).toHaveLength(1);
});

it("keeps entity shortcuts on entity pages and reads the route after navigation", () => {
  stagePayee();
  stageHolds();
  mockPathname = "/accounts";
  const view = renderHook(() => useKeyboardShortcuts());
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  expect(useStagedStore.getState().payees["draft-payee"]).toBeUndefined();
  fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
  expect(useStagedStore.getState().payees["draft-payee"]).toBeDefined();
  act(() => useStagedStore.getState().discardAll());
  mockPathname = "/credit-cards";
  view.rerender();
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  expect(Object.keys(useBudgetEditsStore.getState().holds)).toHaveLength(1);
});

it("does not repeat undo already handled by the budget grid or override text-input undo", () => {
  mockPathname = "/budget-management";
  stageHolds();
  renderHook(() => useKeyboardShortcuts());
  const consumed = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
  consumed.preventDefault();
  fireEvent(document.body, consumed);
  const input = document.createElement("input");
  document.body.appendChild(input);
  fireEvent.keyDown(input, { key: "z", ctrlKey: true });
  input.remove();
  expect(Object.keys(useBudgetEditsStore.getState().holds)).toHaveLength(2);
});
