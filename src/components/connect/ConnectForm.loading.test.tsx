import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { useConnectionStore } from "@/store/connection";
import { ConnectForm } from "./ConnectForm";

/**
 * The connect page doesn't guess before the vault answers (PR-075a): showing
 * the first-run form while saved budgets load made the page jump after sign-in.
 */

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("@/hooks/useIsHydrated", () => ({ useIsHydrated: () => true }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/actual/browser/budgetList", () => ({
  listBrowserApiBudgets: jest.fn(),
  loadBrowserApiBudgetList: jest.fn(),
}));

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const status = { supported: true, passphraseSet: true, unlocked: true, authMode: "password", passwordFromEnv: false };
let statusCall: Deferred<typeof status>;
let listCall: Deferred<unknown>;

jest.mock("@/features/connect/vaultApi", () => ({
  ...jest.requireActual("@/features/connect/vaultApi"),
  getVaultStatus: jest.fn(() => statusCall.promise),
  listRememberedServers: jest.fn(() => listCall.promise),
}));

const SAVED = {
  supported: true,
  servers: [
    {
      serverFingerprint: "srv-1",
      mode: "browser-api",
      baseUrl: "https://actual.example.com",
      label: "actual.example.com",
      createdAt: "",
      updatedAt: "",
    },
  ],
  budgets: [{ serverFingerprint: "srv-1", budgetSyncId: "budget-1", name: "Household", createdAt: "", lastOpenedAt: "" }],
};

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <ConnectForm />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  statusCall = deferred();
  listCall = deferred();
  useConnectionStore.getState().clearAll();
});

it("waits for the vault instead of showing the first-run form, then shows the saved budgets", async () => {
  const vaultApi = jest.requireMock("@/features/connect/vaultApi");
  renderPage();

  expect(screen.getByLabelText("Loading saved connections")).toBeInTheDocument();
  expect(screen.queryByText("Connect your Actual server")).not.toBeInTheDocument();
  // Both requests are already out, neither waiting on the other.
  expect(vaultApi.getVaultStatus).toHaveBeenCalled();
  expect(vaultApi.listRememberedServers).toHaveBeenCalled();

  await act(async () => {
    statusCall.resolve(status);
    listCall.resolve(SAVED);
  });

  expect(await screen.findByText("Household")).toBeInTheDocument();
  expect(screen.queryByText("Connect your Actual server")).not.toBeInTheDocument();
});

it("shows the first-run form once the vault says nothing is saved", async () => {
  renderPage();
  await act(async () => {
    statusCall.resolve(status);
    listCall.resolve({ supported: true, servers: [], budgets: [] });
  });

  expect(await screen.findByText("Connect your Actual server")).toBeInTheDocument();
  expect(screen.queryByLabelText("Loading saved connections")).not.toBeInTheDocument();
});

it("opens straight on the saved budgets when sign-in already loaded them", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["auth-status"], status);
  client.setQueryData(["remembered-servers"], SAVED);
  renderPage(client);

  expect(screen.queryByLabelText("Loading saved connections")).not.toBeInTheDocument();
  expect(screen.getByText("Household")).toBeInTheDocument();
  // It still refreshes quietly behind the scenes.
  await act(async () => {
    statusCall.resolve(status);
    listCall.resolve(SAVED);
  });
  expect(screen.getByText("Household")).toBeInTheDocument();
});

