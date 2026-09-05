"use client";

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReconciliationSessionRecord } from "../lib/reconciliationApi";
import { SessionList } from "./SessionList";

function session(
  overrides: Partial<ReconciliationSessionRecord> & Pick<ReconciliationSessionRecord, "id">
): ReconciliationSessionRecord {
  const { id, ...rest } = overrides;
  return {
    id,
    budgetSyncId: "budget-1",
    accountId: "account-1",
    accountName: "CC-UAE Dubai First 7773",
    profileId: null,
    status: "completed",
    statementName: "statement.csv",
    statementStart: "2026-07-07",
    statementEnd: "2026-08-06",
    candidateStart: null,
    candidateEnd: null,
    statementFingerprint: null,
    statementFormat: null,
    matchConfig: null,
    totals: { rowCount: 42 },
    applyResults: null,
    applyConfig: null,
    tag: null,
    createdAt: "2026-08-07T09:00:00.000Z",
    updatedAt: "2026-08-07T10:00:00.000Z",
    appliedAt: "2026-08-07T10:00:00.000Z",
    ...rest,
  };
}

function renderList(sessions: ReconciliationSessionRecord[]) {
  const callbacks = {
    onOpen: jest.fn(),
    onDelete: jest.fn(),
    onRetag: jest.fn(),
    onNew: jest.fn(),
  };
  render(<SessionList sessions={sessions} {...callbacks} />);
  return callbacks;
}

const DUBAI = "CC-UAE Dubai First 7773";
const HSBC = "CC-UAE HSBC Premier 1188";

function fixtures() {
  const dubaiActive = session({
    id: "dubai-active",
    status: "needs_review",
    statementName: "dubai-active.csv",
    appliedAt: null,
    updatedAt: "2026-08-09T10:00:00.000Z",
  });
  const dubaiApplied = session({
    id: "dubai-applied",
    tag: "Q2 close",
    statementName: "dubai-applied.csv",
    statementStart: "2026-05-07",
    statementEnd: "2026-06-06",
    updatedAt: "2026-06-07T10:00:00.000Z",
  });
  const hsbcApplied = session({
    id: "hsbc-applied",
    tag: "Archive",
    accountId: "account-2",
    accountName: HSBC,
    statementName: "hsbc-applied.csv",
    statementStart: "2025-05-09",
    statementEnd: "2025-06-05",
    createdAt: "2025-06-06T09:00:00.000Z",
    updatedAt: "2025-06-06T10:00:00.000Z",
    appliedAt: "2025-06-06T10:00:00.000Z",
  });
  return { dubaiActive, dubaiApplied, hsbcApplied };
}

describe("reconciliation sessions grouped by account", () => {
  it("uses one table and expands only accounts needing attention by default", () => {
    const { dubaiActive, dubaiApplied, hsbcApplied } = fixtures();
    renderList([dubaiApplied, hsbcApplied, dubaiActive]);

    const table = screen.getByRole("table", { name: "Reconciliation sessions" });
    expect(screen.getAllByRole("table", { name: "Reconciliation sessions" })).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { name: "Tag" })).toHaveLength(1);
    expect(screen.getByRole("columnheader", { name: "Statement" })).toHaveClass("w-[20%]");
    expect(screen.getByRole("columnheader", { name: "Period" })).toHaveClass("w-[20%]");

    const dubaiGroup = screen.getByRole("button", { name: `Collapse ${DUBAI} sessions` });
    expect(dubaiGroup).toHaveAttribute("aria-expanded", "true");
    expect(dubaiGroup).toHaveTextContent("2 sessions · 1 needs attention");
    expect(screen.getByText("dubai-active.csv")).toBeInTheDocument();
    const activeRow = screen.getByText("dubai-active.csv").closest("tr");
    const accountCell = activeRow?.querySelector("td");
    expect(accountCell).toHaveClass("py-0.5");
    expect(dubaiGroup).toHaveClass("py-1.5");
    expect(accountCell?.querySelector("svg")).toBeNull();
    expect(screen.getByText("dubai-applied.csv")).toBeInTheDocument();
    expect(within(table).getAllByText(DUBAI)).toHaveLength(1);

    const hsbcGroup = screen.getByRole("button", { name: `Expand ${HSBC} sessions` });
    expect(hsbcGroup).toHaveAttribute("aria-expanded", "false");
    expect(hsbcGroup).toHaveTextContent("1 session · all applied");
    expect(screen.queryByText("hsbc-applied.csv")).toBeNull();
  });

  it("lets users expand and collapse groups without changing row actions", () => {
    const { dubaiActive, hsbcApplied } = fixtures();
    const { onOpen, onDelete } = renderList([dubaiActive, hsbcApplied]);

    fireEvent.click(screen.getByRole("button", { name: `Expand ${HSBC} sessions` }));
    expect(screen.getByText("hsbc-applied.csv")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(onOpen).toHaveBeenCalledWith(hsbcApplied);

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`Delete the reconciliation for ${HSBC}`) })
    );
    expect(onDelete).toHaveBeenCalledWith(hsbcApplied);

    fireEvent.click(screen.getByRole("button", { name: `Collapse ${DUBAI} sessions` }));
    expect(screen.queryByText("dubai-active.csv")).toBeNull();
  });

  it("expands and collapses all visible account groups from one control", () => {
    const { dubaiActive, hsbcApplied } = fixtures();
    renderList([dubaiActive, hsbcApplied]);

    fireEvent.click(screen.getByRole("button", { name: "Collapse all groups" }));
    expect(screen.getByRole("button", { name: `Expand ${DUBAI} sessions` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Expand ${HSBC} sessions` })).toBeInTheDocument();
    expect(screen.queryByText("dubai-active.csv")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand all groups" }));
    expect(screen.getByRole("button", { name: `Collapse ${DUBAI} sessions` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Collapse ${HSBC} sessions` })).toBeInTheDocument();
    expect(screen.getByText("dubai-active.csv")).toBeInTheDocument();
    expect(screen.getByText("hsbc-applied.csv")).toBeInTheDocument();
  });

  it("adds an Account filter and exposes matching applied groups", () => {
    const { dubaiActive, hsbcApplied } = fixtures();
    renderList([dubaiActive, hsbcApplied]);

    fireEvent.change(screen.getByLabelText("Filter by account"), {
      target: { value: "account-2" },
    });

    expect(screen.queryByRole("button", { name: new RegExp(DUBAI) })).toBeNull();
    expect(screen.getByRole("button", { name: `Collapse ${HSBC} sessions` })).toBeInTheDocument();
    expect(screen.getByText("hsbc-applied.csv")).toBeInTheDocument();
  });

  it("keeps year and month as filters and exposes a cross-month result", () => {
    const { hsbcApplied } = fixtures();
    renderList([hsbcApplied]);

    fireEvent.change(screen.getByLabelText("Filter by statement year"), {
      target: { value: "2025" },
    });
    fireEvent.change(screen.getByLabelText("Filter by statement month"), {
      target: { value: "06" },
    });

    expect(screen.getByRole("button", { name: `Collapse ${HSBC} sessions` })).toBeInTheDocument();
    expect(screen.getByText("hsbc-applied.csv")).toBeInTheDocument();
    expect(screen.queryByText("2025", { selector: "th" })).toBeNull();
  });

  it("preserves status, tag, and search filtering while exposing matches", () => {
    const { dubaiActive, dubaiApplied, hsbcApplied } = fixtures();
    renderList([dubaiActive, dubaiApplied, hsbcApplied]);

    fireEvent.click(screen.getByRole("button", { name: /Applied 2/ }));
    expect(screen.queryByText("dubai-active.csv")).toBeNull();
    expect(screen.getByText("dubai-applied.csv")).toBeInTheDocument();
    expect(screen.getByText("hsbc-applied.csv")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter by tag"), {
      target: { value: "Archive" },
    });
    expect(screen.queryByRole("button", { name: new RegExp(DUBAI) })).toBeNull();
    expect(screen.getByText("hsbc-applied.csv")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search reconciliation sessions"), {
      target: { value: "hsbc" },
    });
    expect(screen.getByRole("button", { name: `Collapse ${HSBC} sessions` })).toBeInTheDocument();
  });

  it("sorts sessions within each account using the shared column headers", () => {
    const { dubaiActive, dubaiApplied } = fixtures();
    renderList([dubaiApplied, dubaiActive]);
    const table = screen.getByRole("table", { name: "Reconciliation sessions" });
    const statementOrder = () =>
      within(table)
        .getAllByText(/dubai-(active|applied)\.csv/)
        .map((entry) => entry.textContent);

    expect(statementOrder()).toEqual(["dubai-active.csv", "dubai-applied.csv"]);
    fireEvent.click(screen.getByRole("button", { name: /Last worked on/ }));
    expect(statementOrder()).toEqual(["dubai-applied.csv", "dubai-active.csv"]);
  });
});
