import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VaultHealth, type VaultStateResponse } from "./VaultHealth";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

function respond(state: VaultStateResponse) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const body = url === "/api/vault/reset" ? { vault: { status: "ready" } } : state;
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
  return calls;
}

function renderRow(enrolledLabels: string[] = [], client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <VaultHealth enrolledLabels={enrolledLabels} />
    </QueryClientProvider>
  );
}

describe("App Health vault row", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("says a generated key file is in use, and to keep it", async () => {
    respond({ status: "ready", source: "file", keyPath: "/data/secrets/vault.key", storedSecrets: 2 });
    renderRow();

    expect(await screen.findByText("/data/secrets/vault.key")).toBeInTheDocument();
    expect(screen.getByText(/Keep this file with the rest of your data/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset vault/i })).not.toBeInTheDocument();
  });

  it("asks for the old variable to be renamed", async () => {
    respond({
      status: "ready",
      source: "legacy-environment",
      warning: "legacy-name",
      keyPath: "/data/secrets/vault.key",
      storedSecrets: 0,
    });
    renderRow();

    expect(await screen.findByText(/is an old name/)).toBeInTheDocument();
  });

  it("explains a locked vault, re-checks on request, and resets only after confirming", async () => {
    const calls = respond({
      status: "locked",
      reason: "missing",
      message: "Bench can't find the vault key that sealed its stored credentials.",
      keyPath: "/data/secrets/vault.key",
      storedSecrets: 3,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, "invalidateQueries");
    renderRow(["Household", "Business"], client);

    expect(await screen.findByText(/can't find the vault key/)).toBeInTheDocument();
    expect(screen.getByText(/Put the original key file back/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    await waitFor(() => expect(calls.filter((call) => call === "GET /api/vault")).toHaveLength(2));
    // A restored key must refresh what depends on it too, not only this row.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sync-vault-status"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["automation-health"] });

    fireEvent.click(screen.getByRole("button", { name: /reset vault/i }));
    expect(await screen.findByText(/deletes the 3 stored secrets/)).toBeInTheDocument();
    expect(screen.getByText(/Household, Business/)).toBeInTheDocument();
    expect(calls).not.toContain("POST /api/vault/reset");

    fireEvent.click(screen.getByRole("button", { name: "Reset vault" }));
    await waitFor(() => expect(calls).toContain("POST /api/vault/reset"));
  });

  it("offers no reset when the only fix is a writable folder", async () => {
    respond({
      status: "locked",
      reason: "cannot-create",
      message: "Bench couldn't create a vault key because its data folder can't be written.",
      detail: "EACCES: permission denied, mkdir '/data/secrets'",
      keyPath: "/data/secrets/vault.key",
      storedSecrets: 0,
    });
    renderRow();

    expect(await screen.findByText(/EACCES/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset vault/i })).not.toBeInTheDocument();
  });
});
