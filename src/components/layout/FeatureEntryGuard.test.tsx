import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PendingPanelProvider } from "./PendingPanelContext";
import { FeatureEntryGuard } from "./FeatureEntryGuard";
import { getFeatureForPath } from "@/lib/features/catalogue";
import { useDiscardChanges } from "@/features/credit-cards/hooks/useDiscardChanges";
import { hasUnsavedDrafts } from "@/lib/unsavedDrafts";
import { useStagedStore } from "@/store/staged";
import { useBudgetEditsStore } from "@/store/budgetEdits";

beforeEach(() => { useStagedStore.getState().discardAll(); useBudgetEditsStore.getState().discardAll(); });
afterEach(() => { useStagedStore.getState().discardAll(); useBudgetEditsStore.getState().discardAll(); });

it.each(["/credit-cards", "/reconciliation/session", "/loans/new"])("does not mount %s until both draft stores are resolved", path => {
  useStagedStore.getState().stageNew("payees", { id: "pending", name: "Pending" });
  useBudgetEditsStore.getState().stageHold({ month: "2026-10", nextAmount: 100, previousAmount: 0 });
  const workspace = jest.fn(() => <p>Workspace mounted</p>);
  const Workspace = workspace;
  render(<PendingPanelProvider><FeatureEntryGuard feature={getFeatureForPath(path)}><Workspace /></FeatureEntryGuard></PendingPanelProvider>);
  expect(workspace).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Resolve your pending changes" })).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Pending change actions" })).not.toBeInTheDocument();
  expect(useBudgetEditsStore.getState().holds["2026-10"]).toBeDefined();
  act(() => useStagedStore.getState().discardAll());
  expect(workspace).not.toHaveBeenCalled();
  expect(screen.getByText(/Review and save or discard your changes in the panel/)).toBeInTheDocument();
  act(() => useBudgetEditsStore.getState().discardAll());
  expect(screen.getByText("Workspace mounted")).toBeInTheDocument();
});


it.each([false, true])("preserves a local editor when global drafts appear after admission (initially blocked: %s)", initiallyBlocked => {
  if (initiallyBlocked) useStagedStore.getState().stageNew("payees", { id: "entry", name: "Entry draft" });
  function Editor() {
    const [value, setValue] = useState("");
    const { discardDialog } = useDiscardChanges(Boolean(value), () => {});
    return <><input aria-label="Local draft" value={value} onChange={event => setValue(event.target.value)} />{discardDialog}</>;
  }
  const feature = getFeatureForPath("/credit-cards");
  const view = render(<FeatureEntryGuard key="first-entry" feature={feature}><Editor /></FeatureEntryGuard>);
  if (initiallyBlocked) act(() => useStagedStore.getState().discardAll());
  fireEvent.change(screen.getByLabelText("Local draft"), { target: { value: "Unsaved statement review" } });
  act(() => useStagedStore.getState().stageNew("payees", { id: "quick-create", name: "Quick-created" }));
  expect(screen.getByLabelText("Local draft")).toHaveValue("Unsaved statement review");
  expect(hasUnsavedDrafts()).toBe(true);
  act(() => useStagedStore.getState().discardAll());
  expect(screen.getByLabelText("Local draft")).toHaveValue("Unsaved statement review");
  act(() => useBudgetEditsStore.getState().stageHold({ month: "2026-10", nextAmount: 100, previousAmount: 0 }));
  expect(screen.getByLabelText("Local draft")).toHaveValue("Unsaved statement review");
  view.rerender(<FeatureEntryGuard key="second-entry" feature={feature}><Editor /></FeatureEntryGuard>);
  expect(screen.queryByLabelText("Local draft")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Resolve your pending changes" })).toBeInTheDocument();
});


it("lets Budget Cockpit keep its own budget edits after entity entry drafts are resolved", () => {
  useStagedStore.getState().stageNew("payees", { id: "entry", name: "Entry draft" });
  useBudgetEditsStore.getState().stageHold({ month: "2026-10", nextAmount: 100, previousAmount: 0 });
  render(<FeatureEntryGuard feature={getFeatureForPath("/budget-management")}><p>Budget workspace</p></FeatureEntryGuard>);
  expect(screen.queryByText("Budget workspace")).not.toBeInTheDocument();
  act(() => useStagedStore.getState().discardAll());
  expect(screen.getByText("Budget workspace")).toBeInTheDocument();
  expect(useBudgetEditsStore.getState().holds["2026-10"]).toBeDefined();
});
