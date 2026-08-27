import { render, screen } from "@testing-library/react";
import { AutomationResult } from "./resultRenderers";
import type { AutomationRun } from "@/lib/app-db/types";

function run(type: string, data: Record<string, unknown>): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    type,
    status: "succeeded",
    startedAt: "2026-08-27T06:00:00.000Z",
    finishedAt: "2026-08-27T06:00:20.000Z",
    trigger: "schedule",
    attempt: 1,
    executionMode: "server",
    result: { version: 1, data: data as never },
    rollup: null,
    error: null,
  };
}

describe("bank sync run results", () => {
  it("shows what happened per account, in this job type's own terms", () => {
    render(
      <AutomationResult
        run={run("bank-sync", {
          countsObserved: true,
          accounts: [
            { accountId: "a", accountName: "Checking", status: "synced", message: null, observedNewTransactions: 4 },
            { accountId: "b", accountName: "Savings", status: "failed", message: "consent expired", observedNewTransactions: null },
            { accountId: "c", accountName: "Cash", status: "not-linked", message: null, observedNewTransactions: null },
          ],
        })}
      />
    );

    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("4 new", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("consent expired", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("No bank link")).toBeInTheDocument();
  });

  it("says Bench cannot know the count when the server only accepted the request", () => {
    render(
      <AutomationResult
        run={run("bank-sync", {
          countsObserved: false,
          accounts: [{ accountId: "a", accountName: "Checking", status: "accepted", message: null, observedNewTransactions: null }],
        })}
      />
    );

    expect(screen.getByText(/cannot say how many transactions arrived/)).toBeInTheDocument();
  });

  it("survives a payload whose shape is not what this version expects", () => {
    // The engine stores a job type's result without inspecting it, and an older
    // version of the feature may have written something else. Putting that
    // straight into React took down the whole run-history panel once already.
    render(
      <AutomationResult
        run={run("bank-sync", {
          countsObserved: true,
          accounts: [
            { accountId: "a", accountName: { nested: "object" }, status: 42, observedNewTransactions: "many" },
            "not even an object",
            { accountName: "no id at all" },
            { accountId: "b", accountName: "Valid", status: "synced" },
          ],
        })}
      />
    );

    // The unreadable rows are dropped rather than crashing the panel, and the
    // readable one still renders.
    expect(screen.getByText("Valid")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("falls back to a readable rendering for a job type with no renderer", () => {
    render(<AutomationResult run={run("some-future-type", { widgets: 3, mode: "fast" })} />);

    expect(screen.getByText("widgets")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
