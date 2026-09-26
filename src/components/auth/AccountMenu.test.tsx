import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { VaultStatus } from "@/features/connect/vaultApi";
import { AccountMenu, signOut } from "./AccountMenu";

const fullPageLoad = jest.fn();
jest.mock("@/lib/auth/fullPageLoad", () => ({ fullPageLoad: (path: string) => fullPageLoad(path) }));

const toastError = jest.fn();
jest.mock("sonner", () => ({ toast: { error: (message: string) => toastError(message), success: jest.fn() } }));

const getVaultStatus = jest.fn<Promise<VaultStatus>, []>();
const lockVault = jest.fn();
jest.mock("@/features/connect/vaultApi", () => ({
  getVaultStatus: () => getVaultStatus(),
  lockVault: () => lockVault(),
  changeVaultPassphrase: jest.fn(),
}));

function status(overrides: Partial<VaultStatus> = {}): VaultStatus {
  return { supported: true, passphraseSet: true, unlocked: true, authMode: "password", passwordFromEnv: false, ...overrides };
}

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AccountMenu />
    </QueryClientProvider>
  );
}

describe("the account menu (RD-096)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("is there when sign-in is on, and not when it is off", async () => {
    getVaultStatus.mockResolvedValue(status());
    const { unmount } = renderMenu();
    expect(await screen.findByRole("button", { name: "Account" })).toBeInTheDocument();
    unmount();

    getVaultStatus.mockResolvedValue(status({ authMode: "none" }));
    renderMenu();
    await waitFor(() => expect(getVaultStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Account" })).not.toBeInTheDocument();
  });

  it("marks change password as set by the environment when it is", async () => {
    getVaultStatus.mockResolvedValue(status({ passwordFromEnv: true }));
    renderMenu();
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    expect(await screen.findByText("Set by ACTUAL_BENCH_PASSWORD")).toBeInTheDocument();
  });
});

describe("signOut", () => {
  beforeEach(() => jest.clearAllMocks());

  it("ends the session, forgets the tab's budgets, then leaves for the sign-in page", async () => {
    sessionStorage.setItem("actual-admin-last-active-ref", "{}");
    lockVault.mockResolvedValue({ ok: true });
    const beforeLeave = jest.fn();
    await signOut({ beforeLeave });
    expect(beforeLeave).toHaveBeenCalled();
    expect(sessionStorage.getItem("actual-admin-last-active-ref")).toBeNull();
    expect(fullPageLoad).toHaveBeenCalledWith("/login");
  });

  it("stays put and says so when the server does not confirm", async () => {
    lockVault.mockRejectedValue(Object.assign(new Error("Server unavailable."), { fromVault: true }));
    const beforeLeave = jest.fn();
    await signOut({ beforeLeave });
    expect(toastError).toHaveBeenCalledWith("Could not sign out: Server unavailable.");
    expect(beforeLeave).not.toHaveBeenCalled();
    expect(fullPageLoad).not.toHaveBeenCalled();
  });
});
