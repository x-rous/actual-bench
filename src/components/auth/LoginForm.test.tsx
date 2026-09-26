import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { VaultStatus } from "@/features/connect/vaultApi";
import { LoginForm } from "./LoginForm";

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
jest.mock("next/image", () => ({ __esModule: true, default: () => null }));

const preloadVault = jest.fn(async () => undefined);
const resumeSession = jest.fn(async () => undefined);
jest.mock("@/features/connect/resumeSession", () => ({ resumeSession: (...args: unknown[]) => resumeSession(...(args as [])) }));
jest.mock("@/features/connect/vaultQueries", () => ({ preloadVault: () => preloadVault() }));

function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const getVaultStatus = jest.fn<Promise<VaultStatus>, []>();
const setVaultPassphrase = jest.fn();
const unlockVault = jest.fn();
jest.mock("@/features/connect/vaultApi", () => ({
  getVaultStatus: () => getVaultStatus(),
  setVaultPassphrase: (...args: unknown[]) => setVaultPassphrase(...args),
  unlockVault: (...args: unknown[]) => unlockVault(...args),
}));

function status(overrides: Partial<VaultStatus> = {}): VaultStatus {
  return { supported: true, passphraseSet: true, unlocked: false, authMode: "password", passwordFromEnv: false, ...overrides };
}

describe("the sign-in page (RD-096)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("signs in, loads what the next page shows, then goes there without a reload", async () => {
    getVaultStatus.mockResolvedValue(status());
    unlockVault.mockResolvedValue({ ok: true, unlocked: true });
    render(<LoginForm next="/rules" />);

    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "the-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/rules"));
    expect(unlockVault).toHaveBeenCalledWith("the-password", expect.any(String));
    expect(preloadVault).toHaveBeenCalled();
  });

  it("shows the server's answer when the password is wrong, and stays", async () => {
    getVaultStatus.mockResolvedValue(status());
    unlockVault.mockRejectedValue(Object.assign(new Error("Incorrect password."), { fromVault: true }));
    render(<LoginForm next="/connect" />);

    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "wrong-one" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Incorrect password.")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("asks a fresh install to set the password, and checks it was typed twice alike", async () => {
    getVaultStatus.mockResolvedValue(status({ passphraseSet: false }));
    setVaultPassphrase.mockResolvedValue({ ok: true, unlocked: true });
    render(<LoginForm next="/connect" />);

    expect(await screen.findByText("Set a password")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "first-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "other-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Set password and continue" }));
    expect(await screen.findByText("The passwords do not match.")).toBeInTheDocument();
    expect(setVaultPassphrase).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "first-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Set password and continue" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/connect"));
    expect(setVaultPassphrase).toHaveBeenCalledWith("first-password", expect.any(String));
  });

  it("moves straight on when sign-in is off", async () => {
    getVaultStatus.mockResolvedValue(status({ authMode: "none" }));
    render(<LoginForm next="/connect" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/connect"));
  });

  it("reopens the tab's budgets before going back to a page of the app", async () => {
    sessionStorage.setItem(
      "actual-admin-last-active-ref",
      JSON.stringify({ active: { fingerprint: "srv", budgetSyncId: "b-1", label: "Household" }, others: [] })
    );
    getVaultStatus.mockResolvedValue(status());
    unlockVault.mockResolvedValue({ ok: true, unlocked: true });
    render(<LoginForm next="/rules" />);

    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "the-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/rules"));
    expect(resumeSession).toHaveBeenCalledWith(expect.objectContaining({ active: expect.objectContaining({ budgetSyncId: "b-1" }) }));
    sessionStorage.clear();
  });

  it("doesn't reopen budgets when going to the connect page", async () => {
    sessionStorage.setItem(
      "actual-admin-last-active-ref",
      JSON.stringify({ active: { fingerprint: "srv", budgetSyncId: "b-1", label: "Household" }, others: [] })
    );
    getVaultStatus.mockResolvedValue(status());
    unlockVault.mockResolvedValue({ ok: true, unlocked: true });
    render(<LoginForm next="/connect" />);

    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "the-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/connect"));
    expect(resumeSession).not.toHaveBeenCalled();
    sessionStorage.clear();
  });
});
