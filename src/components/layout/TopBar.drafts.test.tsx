import { useState } from "react";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopBar } from "./TopBar";
import { useConnectionStore, selectActiveInstance, type ConnectionInstance } from "@/store/connection";
import { useDiscardChanges } from "@/features/credit-cards/hooks/useDiscardChanges";
import { hasUnsavedDrafts } from "@/lib/unsavedDrafts";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => "/credit-cards" }));
jest.mock("@/hooks/useAuthStatus", () => ({ useAuthStatus: () => ({ data: { authMode: "none" } }) }));
jest.mock("@/hooks/useConnectionHealth", () => ({ useConnectionHealthContext: () => ({ status: "online" }) }));
jest.mock("./ConnectionHealthDot", () => ({ ConnectionHealthDot: () => null }));
jest.mock("./useBudgetSavePipeline", () => ({ useBudgetSavePipeline: () => ({ saveAll: jest.fn(), isSaving: false }) }));
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
  return <><TopBar />{connection && <Editor key={connection.id} />}</>;
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
