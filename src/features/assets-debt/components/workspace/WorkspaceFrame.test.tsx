import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WorkspaceFrame, workspaceTabFor } from "./WorkspaceFrame";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: jest.fn() }) }));

describe("Loan workspace frame", () => {
  beforeEach(() => push.mockClear());

  it("shows the five tabs in order, marks one that needs attention, and has a back link", () => {
    const onTab = jest.fn();
    render(<WorkspaceFrame title="HSBC" state="Saved" tab="activity" onTab={onTab} dirty={false} attention={{ activity: "2 unresolved writes" }}><p>body</p></WorkspaceFrame>);
    const nav = screen.getByRole("navigation", { name: "Loan sections" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Terms & Schedule", "Link to Actual", "Repayments", "Loan Ledger", "Linked Assets"]);
    expect(within(nav).getByRole("img", { name: "2 unresolved writes" })).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole("button", { name: "Loan Ledger" }));
    expect(onTab).toHaveBeenCalledWith("ledger");
    fireEvent.click(screen.getByRole("button", { name: /Loans & Debt/ }));
    expect(push).toHaveBeenCalledWith("/loans");
  });

  it("leaving with unsaved changes asks: Stay, Discard changes, or Save and leave", async () => {
    const save = jest.fn(async () => true);
    render(<WorkspaceFrame title="HSBC" state="Unsaved changes" tab="calculation" onTab={jest.fn()} dirty onSaveAndLeave={save}><p>body</p></WorkspaceFrame>);
    fireEvent.click(screen.getByRole("button", { name: /Loans & Debt/ }));
    expect(await screen.findByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/loans"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("old and new links open the tab that holds their content", () => {
    expect(workspaceTabFor("simulator", "activity")).toBe("calculation");
    expect(workspaceTabFor("matching", "activity")).toBe("setup");
    expect(workspaceTabFor("transactions", "calculation")).toBe("activity");
    expect(workspaceTabFor("ledger", "activity")).toBe("ledger");
    expect(workspaceTabFor("assets", "activity")).toBe("assets");
    expect(workspaceTabFor(null, "activity")).toBe("activity");
    expect(workspaceTabFor("nonsense", "calculation")).toBe("calculation");
  });
});
