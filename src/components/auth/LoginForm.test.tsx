import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VaultStatus } from "@/features/connect/vaultApi";
import { LoginForm } from "./LoginForm";

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
jest.mock("next/image", () => ({ __esModule: true, default: () => null }));

const fullPageLoad = jest.fn();
jest.mock("@/lib/auth/fullPageLoad", () => ({ fullPageLoad: (path: string) => fullPageLoad(path) }));

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

  it("signs in and loads the page the user was going to", async () => {
    getVaultStatus.mockResolvedValue(status());
    unlockVault.mockResolvedValue({ ok: true, unlocked: true });
    render(<LoginForm next="/rules" />);

    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "the-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(fullPageLoad).toHaveBeenCalledWith("/rules"));
    expect(unlockVault).toHaveBeenCalledWith("the-password", expect.any(String));
  });

  it("shows the server's answer when the password is wrong, and stays", async () => {
    getVaultStatus.mockResolvedValue(status());
    unlockVault.mockRejectedValue(Object.assign(new Error("Incorrect password."), { fromVault: true }));
    render(<LoginForm next="/connect" />);

    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "wrong-one" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Incorrect password.")).toBeInTheDocument();
    expect(fullPageLoad).not.toHaveBeenCalled();
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
    await waitFor(() => expect(fullPageLoad).toHaveBeenCalledWith("/connect"));
    expect(setVaultPassphrase).toHaveBeenCalledWith("first-password", expect.any(String));
  });

  it("moves straight on when sign-in is off", async () => {
    getVaultStatus.mockResolvedValue(status({ authMode: "none" }));
    render(<LoginForm next="/connect" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/connect"));
  });
});
