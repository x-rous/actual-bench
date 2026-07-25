import { fireEvent, render, screen } from "@testing-library/react";
import { ConnectionOfflineBanner } from "./ConnectionOfflineBanner";
import {
  ConnectionHealthContext,
  type ConnectionHealthState,
} from "@/hooks/useConnectionHealth";

function renderBanner(overrides: Partial<ConnectionHealthState> = {}) {
  const value: ConnectionHealthState = {
    status: "offline",
    latencyMs: null,
    showBanner: true,
    recheck: jest.fn(),
    ...overrides,
  };
  render(
    <ConnectionHealthContext.Provider value={value}>
      <ConnectionOfflineBanner />
    </ConnectionHealthContext.Provider>,
  );
  return value;
}

describe("ConnectionOfflineBanner", () => {
  it("renders nothing when the banner is not active", () => {
    renderBanner({ showBanner: false });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not claim saves are disabled (copy must match actual behavior)", () => {
    renderBanner();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/lost connection to server/i);
    expect(alert).toHaveTextContent(
      /changes may not save until the connection is restored/i,
    );
    expect(alert).not.toHaveTextContent(/save disabled/i);
  });

  it("runs an immediate recheck when 'Retry now' is clicked", () => {
    const { recheck } = renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /retry now/i }));
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("disables the button while a check is in flight", () => {
    renderBanner({ status: "checking" });
    expect(screen.getByRole("button", { name: /checking/i })).toBeDisabled();
  });
});
