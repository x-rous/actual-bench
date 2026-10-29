import { useState } from "react";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PendingPanelProvider, PendingActionsSlot } from "./PendingPanelContext";
import { TopBar } from "./TopBar";
import { useConnectionStore, selectActiveInstance, type ConnectionInstance } from "@/store/connection";
import { useDiscardChanges } from "@/features/credit-cards/hooks/useDiscardChanges";
import { useStagedStore } from "@/store/staged";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { hasUnsavedDrafts } from "@/lib/unsavedDrafts";

const mockSaveAll = jest.fn().mockResolvedValue({ totalSucceeded: 0, totalFailed: 1 });
let mockPathname = "/credit-cards";
beforeEach(() => { mockPathname = "/credit-cards"; });
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => mockPathname }));
jest.mock("@/hooks/useAuthStatus", () => ({ useAuthStatus: () => ({ data: { authMode: "none" } }) }));
jest.mock("@/hooks/useConnectionHealth", () => ({ useConnectionHealthContext: () => ({ status: "online" }) }));
jest.mock("./ConnectionHealthDot", () => ({ ConnectionHealthDot: () => null }));
jest.mock("./useBudgetSavePipeline", () => ({ useBudgetSavePipeline: () => ({ saveAll: mockSaveAll, isSaving: false }) }));
jest.mock("@/features/budget-management/hooks/useBudgetSave", () => ({ useBudgetSave: () => ({ isSaving: false }) }));
jest.mock("@/features/connect/useSavedBudgetSwitcher", () => ({ useSavedBudgetSwitcher: () => ({ saved: [], locked: false, connectingTo: null, unlock: jest.fn(), open: jest.fn(), dialog: null }) }));
jest.mock("@/components/auth/AccountMenu", () => ({ AccountMenu: () => null, signOut: jest.fn() }));

const first: ConnectionInstance = { id: "first", label: "First budget", budgetSyncId: "first-budget", mode: "http-api", baseUrl: "http://localhost", apiKey: "test" };
const second = { ...first, id: "second", label: "Second budget", budgetSyncId: "second-budget" };

function Editor() {
  const [value, setValue] = useState("");
  const { discardDialog } = useDiscardChanges(Boolean(value), () => {});
  return <><input aria-label="Review reason" value={value} onChange={(event) => setValue(event.target.value)} />{discardDialog}</>;
}
function Workspace() {
  const connection = useConnectionStore(selectActiveInstance);
  return <PendingPanelProvider><TopBar /><aside aria-label="Panel header"><PendingActionsSlot /></aside>{connection && <Editor key={connection.id} />}</PendingPanelProvider>;
}
function setup() {
  useConnectionStore.setState({ instances: [first, second], activeInstanceId: first.id });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><Workspace /></QueryClientProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Review reason" }), { target: { value: "Unsaved decision" } });
  return view;
}
async function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /First budget/ }));
  return within(await screen.findByRole("menu"));
}

it("keeps a credit-card draft on Cancel and switches only after confirming discard", async () => {
  const view = setup();
  fireEvent.click((await openMenu()).getByRole("menuitem", { name: /^Connected Second budget/ }));
  const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
  expect(useConnectionStore.getState().activeInstanceId).toBe(first.id);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("textbox", { name: "Review reason" })).toHaveValue("Unsaved decision");
  fireEvent.click((await openMenu()).getByRole("menuitem", { name: /^Connected Second budget/ }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard & Continue" }));
  await waitFor(() => expect(useConnectionStore.getState().activeInstanceId).toBe(second.id));
  expect(screen.getByRole("textbox", { name: "Review reason" })).toHaveValue("");
  view.unmount();
  expect(hasUnsavedDrafts()).toBe(false);
});

it.each(["Disconnect First budget", "Disconnect all"])("guards %s without dropping the active review prematurely", async (action) => {
  const view = setup();
  fireEvent.click((await openMenu()).getByRole("menuitem", { name: action }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(useConnectionStore.getState().instances).toHaveLength(2);
  expect(screen.getByRole("textbox", { name: "Review reason" })).toHaveValue("Unsaved decision");
  fireEvent.click((await openMenu()).getByRole("menuitem", { name: action }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard & Continue" }));
  await waitFor(() => expect(useConnectionStore.getState().instances).toHaveLength(action === "Disconnect all" ? 0 : 1));
  view.unmount();
  expect(hasUnsavedDrafts()).toBe(false);
});


it.each([
  ["/accounts", true], ["/budget-management", true], ["/payees/cleanup", true],
  ["/rules/diagnostics", true], ["/credit-cards", false], ["/query", false],
  ["/overview", false], ["/app-health", false], ["/automations/runs", false],
])("shows staged controls only on applicable pages: %s", (path, visible) => {
  mockPathname = path;
  const view = setup();
  for (const name of ["Save", "Discard", "Undo", "Redo"]) {
    const button = screen.queryByRole("button", { name });
    if (visible) expect(button).toBeInTheDocument();
    else expect(button).not.toBeInTheDocument();
  }
  expect(screen.getByRole("button", { name: "Refresh budget from Actual" })).toBeInTheDocument();
  view.unmount();
});

it("allows pending edits to be saved from a visible panel without discarding work", () => {
  useStagedStore.getState().stageNew("payees", { id: "pending-payee", name: "Pending payee" });
  const staged = useStagedStore.getState().payees;
  mockPathname = "/query";
  const view = setup();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(within(screen.getByRole("banner")).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  expect(useStagedStore.getState().payees).toBe(staged);
  view.unmount();
  useStagedStore.getState().discardAll();
});


it.each(["/credit-cards", "/loans/new", "/reconciliation/session", "/budget-management"])("lets the user resolve blocking entity drafts on %s", path => {
  useStagedStore.getState().stageNew("payees", { id: "blocked-payee", name: "Pending" });
  mockPathname = path;
  const view = setup();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(useStagedStore.getState().payees["blocked-payee"]).toBeUndefined();
  if (path !== "/budget-management") expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  view.unmount();
  useStagedStore.getState().discardAll();
});

it("selects budget actions for a blocked credit-card page, including hold-only drafts", () => {
  useBudgetEditsStore.getState().stageHold({ month: "2026-10", nextAmount: 100, previousAmount: 0 });
  mockPathname = "/credit-cards";
  const view = setup();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(useBudgetEditsStore.getState().holds).toEqual({});
  expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  view.unmount();
});

it("exposes app help and theme in the top bar", async () => {
  const view = setup();
  expect(screen.getByRole("button", { name: /^Theme: System/ })).toHaveAttribute("title", expect.stringContaining("System"));
  fireEvent.click(screen.getByRole("button", { name: "Help & feedback" }));
  const menu = await screen.findByRole("menu");
  expect(within(menu).getByRole("menuitem", { name: "Documentation" })).toBeInTheDocument();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Keyboard shortcuts" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  view.unmount();
});

it("keeps experimental status inside the page-information popover", () => {
  const view = setup();
  expect(screen.queryByText("Experimental")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "About Credit Cards (Experimental)" })).toBeInTheDocument();
  view.unmount();
});


it("uses entity Save while Budget Cockpit entry is blocked and preserves failed drafts", async () => {
  useStagedStore.getState().stageNew("payees", { id: "failed-payee", name: "Pending" });
  mockPathname = "/budget-management";
  mockSaveAll.mockClear();
  const view = setup();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mockSaveAll).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
  view.unmount();
  useStagedStore.getState().discardAll();
});


it("keeps Redo available in an open global panel after undoing the last change on a read-only page", () => {
  useStagedStore.getState().pushUndo();
  useStagedStore.getState().stageNew("payees", { id: "undo-payee", name: "Pending" });
  mockPathname = "/query";
  const view = setup();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  view.unmount();
  useStagedStore.getState().discardAll();
});
