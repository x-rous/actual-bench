import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useConnectionStore } from "@/store/connection";
import { useSavedServersStore } from "@/store/savedServers";
import { ConnectForm } from "./ConnectForm";

/**
 * A saved or typed secret never appears in the Connect page - not as text, and
 * not as a field's value, which the browser's inspector can read even in a
 * password field.
 */

const SERVER_SECRET = "vault-server-secret";
const ENCRYPTION_SECRET = "vault-encryption-secret";

let vaultUnlocked = true;
let budgetList: { groupId: string; name: string }[] = [];
const forgetRememberedServer = jest.fn<Promise<{ ok: true }>, [string]>(async () => ({ ok: true }));

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("@/hooks/useIsHydrated", () => ({ useIsHydrated: () => true }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/actual/browser/budgetList", () => ({
  listBrowserApiBudgets: jest.fn(),
  loadBrowserApiBudgetList: jest.fn(async () => ({
    budgets: budgetList,
    serverVersion: "25.1.0",
  })),
}));
jest.mock("@/features/connect/vaultApi", () => ({
  ...jest.requireActual("@/features/connect/vaultApi"),
  getVaultStatus: jest.fn(async () => ({ supported: true, passphraseSet: true, unlocked: vaultUnlocked, authMode: "none", passwordFromEnv: false })),
  listRememberedServers: jest.fn(async () => ({
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
  })),
  forgetRememberedServer: (fingerprint: string) => forgetRememberedServer(fingerprint),
  revealServerSecret: jest.fn(async () => ({
    mode: "browser-api",
    baseUrl: "https://actual.example.com",
    label: "",
    secret: { apiKey: null, serverPassword: SERVER_SECRET, encryptionPassword: ENCRYPTION_SECRET },
  })),
}));

function expectNoSecretOnPage() {
  for (const secret of [SERVER_SECRET, ENCRYPTION_SECRET]) {
    expect(document.body.innerHTML).not.toContain(secret);
    for (const input of document.querySelectorAll("input")) {
      expect(input.value).not.toBe(secret);
    }
  }
}

// jsdom has no ResizeObserver; the budget list's floating scrollbar needs one.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  vaultUnlocked = true;
  budgetList = [{ groupId: "budget-1", name: "Household" }];
  forgetRememberedServer.mockClear();
  useConnectionStore.getState().clearAll();
  useSavedServersStore.getState().clearServers();
});

/**
 * Poll until the page shows `text`. Testing Library's `findBy` never settles
 * on this page once the Direct budget list loads (its polling stalls), while
 * plain timers run fine - so this polls with them.
 */
async function until(text: string | RegExp): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (screen.queryAllByText(text).length > 0) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error(`The page never showed ${text}`);
}

it("opens another budget on a saved server, and goes back, without the secret ever reaching the page", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConnectForm />
    </QueryClientProvider>
  );

  // As reported: Add a server first, then Open another budget.
  await until(/open another budget/i);
  fireEvent.click(screen.getByRole("button", { name: "Add a server" }));
  fireEvent.click(screen.getByRole("button", { name: /open another budget/i }));
  await until("Choose a budget");
  // The budget's saved encryption password is held, and said to be.
  await until(/saved encryption password for this budget will be used/i);
  expectNoSecretOnPage();
  // One budget: nothing to filter.
  expect(screen.queryByLabelText("Filter budgets")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await until(/password saved for this server/i);
  expect(screen.queryByLabelText("Server password")).not.toBeInTheDocument();
  expectNoSecretOnPage();

  // Choosing to type a different one shows an empty field.
  fireEvent.click(screen.getByRole("button", { name: /use a different password/i }));
  expect(screen.getByLabelText("Server password")).toHaveValue("");
  expectNoSecretOnPage();
});

it("offers only a new server while the vault is locked: saved servers cannot be chosen", async () => {
  vaultUnlocked = false;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConnectForm />
    </QueryClientProvider>
  );

  await until("Vault locked");
  fireEvent.click(screen.getByRole("button", { name: "Add a server" }));
  await until(/unlock your saved connections to use these servers/i);

  expect(screen.getByTitle("Unlock your saved connections to use this server")).toBeDisabled();
  expect(screen.getByRole("button", { name: /new server/i })).toBeEnabled();
  expect(screen.getByLabelText("Server password")).toHaveValue("");
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConnectForm />
    </QueryClientProvider>
  );
}

it("asks before forgetting a saved server, and keeps it on Cancel", async () => {
  renderPage();
  await until(/open another budget/i);

  fireEvent.click(screen.getByRole("button", { name: "Forget actual.example.com" }));
  await until("Forget actual.example.com?");
  expect(screen.getByText(/its saved password and budgets are removed/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(forgetRememberedServer).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Forget actual.example.com" }));
  await until("Forget actual.example.com?");
  fireEvent.click(screen.getByRole("button", { name: "Forget" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(forgetRememberedServer).toHaveBeenCalledWith("srv-1");
});

it("filters a long budget list by name or sync ID", async () => {
  budgetList = ["Household", "Business", "Rental", "Travel", "Savings", "Kids"].map((name, i) => ({
    groupId: `budget-${i + 1}`,
    name,
  }));
  renderPage();
  await until(/open another budget/i);
  fireEvent.click(screen.getByRole("button", { name: "Add a server" }));
  fireEvent.click(screen.getByRole("button", { name: /open another budget/i }));
  await until("Choose a budget");

  const filter = screen.getByLabelText("Filter budgets");
  fireEvent.change(filter, { target: { value: "rent" } });
  expect(screen.getByText("Rental")).toBeInTheDocument();
  expect(screen.queryByText("Business")).not.toBeInTheDocument();

  fireEvent.change(filter, { target: { value: "budget-6" } });
  expect(screen.getByText("Kids")).toBeInTheDocument();
  expect(screen.queryByText("Rental")).not.toBeInTheDocument();

  // The selected budget stays in view, so Connect never opens a hidden one.
  fireEvent.change(filter, { target: { value: "" } });
  fireEvent.click(screen.getByText("Travel"));
  fireEvent.change(filter, { target: { value: "nothing like it" } });
  expect(screen.getByText("Travel")).toBeInTheDocument();
  expect(screen.queryByText("No budgets match.")).not.toBeInTheDocument();
  fireEvent.change(filter, { target: { value: "rent" } });
  expect(screen.getByText("Rental")).toBeInTheDocument();
  expect(screen.getByText("Travel")).toBeInTheDocument();
  expect(screen.queryByText("Business")).not.toBeInTheDocument();
});
