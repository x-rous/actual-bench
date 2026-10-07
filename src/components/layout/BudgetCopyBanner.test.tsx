import { act, fireEvent, render, screen } from "@testing-library/react";
import { BudgetCopyBanner } from "./BudgetCopyBanner";
import { DAMAGED_COPY_EVENT } from "@/lib/actual/browser/runtime";

jest.mock("@/store/connection", () => ({ selectActiveInstance: (s: unknown) => s, useConnectionStore: () => ({ id: "c", mode: "browser-api", budgetSyncId: "b1" }) }));
jest.mock("@/lib/actual/browser/runtime", () => ({ DAMAGED_COPY_EVENT: "actual-bench:damaged-copy" }));

/** Keeping this browser's copy of a Direct budget safe (owner decision 2026-10-07). */
describe("budget copy banner", () => {
  it("offers to reload from the server when Actual reports the copy damaged", () => {
    render(<BudgetCopyBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => { window.dispatchEvent(new CustomEvent(DAMAGED_COPY_EVENT)); });
    expect(screen.getByRole("alert")).toHaveTextContent("This browser's copy of the budget is damaged");
    expect(screen.getByRole("button", { name: "Reload from the server" })).toBeInTheDocument();
  });

  it("warns when another tab announces the same budget, and can be dismissed", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    render(<BudgetCopyBanner />);
    const other = new BroadcastChannel("actual-bench:direct-budget-tabs");
    await act(async () => {
      other.postMessage({ type: "open", budget: "b1", tab: "other-tab" });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(await screen.findByRole("status")).toHaveTextContent("This budget is also open in another Actual Bench tab");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
    other.close();
  });
});
