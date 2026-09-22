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

function renderList(
  sessions: ReconciliationSessionRecord[],
  { grouped = false, allYears = true } = {}
) {
  const callbacks = {
    onOpen: jest.fn(),
    onDelete: jest.fn(),
    onRetag: jest.fn(),
    onNew: jest.fn(),
  };
  render(<SessionList sessions={sessions} {...callbacks} />);
  // Grouping is off by default: most accounts have one session, and a heading
  // over a single row is height spent saying what the row already says.
  if (grouped) fireEvent.click(screen.getByRole("button", { name: "Group by account" }));
  // The year filter opens on the current year, which these fixtures straddle
  // deliberately. Tests that are not about that filter widen it back out; the
  // default itself is covered by its own test below.
  if (allYears) {
    fireEvent.change(screen.getByLabelText("Filter by statement year"), { target: { value: "all" } });
  }
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
    renderList([dubaiApplied, hsbcApplied, dubaiActive], { grouped: true });

    const table = screen.getByRole("table", { name: "Reconciliation sessions" });
    expect(screen.getAllByRole("table", { name: "Reconciliation sessions" })).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { name: "Tag" })).toHaveLength(1);
    // Grouped, the account cell is empty on every row, so its width goes to
    // the statement - the one column a reader actually has to read.
    expect(screen.getByRole("columnheader", { name: "Statement" })).toHaveClass("w-[48%]");
    expect(screen.getByRole("columnheader", { name: /Account/ })).toHaveClass("w-0");

    const dubaiGroup = screen.getByRole("button", { name: `Collapse ${DUBAI} sessions` });
    expect(dubaiGroup).toHaveAttribute("aria-expanded", "true");
    // The heading carries the account and nothing else; the counts it used to
    // restate are what the rows under it already show.
    expect(dubaiGroup).toHaveTextContent(DUBAI);
    expect(dubaiGroup).not.toHaveTextContent("sessions");
    expect(screen.getByText("dubai-active.csv")).toBeInTheDocument();
    const activeRow = screen.getByText("dubai-active.csv").closest("tr");
    // The account cell is empty under the heading that already names it.
    expect(activeRow?.querySelector("td")).toBeEmptyDOMElement();
    // Rows stay denser than the heading over them.
    expect(activeRow?.querySelectorAll("td")[1]).toHaveClass("py-0.5");
    expect(dubaiGroup).toHaveClass("py-1.5");
    expect(screen.getByText("dubai-applied.csv")).toBeInTheDocument();
    expect(within(table).getAllByText(DUBAI)).toHaveLength(1);

    const hsbcGroup = screen.getByRole("button", { name: `Expand ${HSBC} sessions` });
    expect(hsbcGroup).toHaveAttribute("aria-expanded", "false");
    expect(hsbcGroup).toHaveTextContent(HSBC);
    expect(screen.queryByText("hsbc-applied.csv")).toBeNull();
  });

  it("lets users expand and collapse groups without changing row actions", () => {
    const { dubaiActive, hsbcApplied } = fixtures();
    const { onOpen, onDelete } = renderList([dubaiActive, hsbcApplied], { grouped: true });

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
    renderList([dubaiActive, hsbcApplied], { grouped: true });

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
    renderList([dubaiActive, hsbcApplied], { grouped: true });

    fireEvent.change(screen.getByLabelText("Filter by account"), {
      target: { value: "account-2" },
    });

    expect(screen.queryByRole("button", { name: new RegExp(DUBAI) })).toBeNull();
    expect(screen.getByRole("button", { name: `Collapse ${HSBC} sessions` })).toBeInTheDocument();
    expect(screen.getByText("hsbc-applied.csv")).toBeInTheDocument();
  });

  it("keeps the year as a filter, and answers to either year a period straddles", () => {
    const newYear = session({
      id: "new-year",
      statementName: "new-year.csv",
      statementStart: "2025-12-20",
      statementEnd: "2026-01-19",
    });
    const { hsbcApplied } = fixtures();
    renderList([hsbcApplied, newYear], { grouped: true });

    fireEvent.change(screen.getByLabelText("Filter by statement year"), {
      target: { value: "2025" },
    });
    expect(screen.getByText("hsbc-applied.csv")).toBeInTheDocument();
    // A cycle running into January belongs to both years, or filtering by the
    // year you remember would hide it.
    expect(screen.getByText("new-year.csv")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter by statement year"), {
      target: { value: "2026" },
    });
    expect(screen.queryByText("hsbc-applied.csv")).toBeNull();
    expect(screen.getByText("new-year.csv")).toBeInTheDocument();
  });

  it("opens on this year, and says so as a filter the reader can clear", () => {
    const thisYear = String(new Date().getFullYear());
    const current = session({
      id: "current",
      statementName: "current.csv",
      statementStart: `${thisYear}-03-01`,
      statementEnd: `${thisYear}-03-31`,
    });
    const { hsbcApplied } = fixtures();
    renderList([hsbcApplied, current], { allYears: false });

    // Most of the time the session you want is one of this year's, and the
    // years before it are history.
    expect(screen.getByLabelText("Filter by statement year")).toHaveValue(thisYear);
    expect(screen.getByText("current.csv")).toBeInTheDocument();
    expect(screen.queryByText("hsbc-applied.csv")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("hsbc-applied.csv")).toBeInTheDocument();
  });

  it("counts a straddling period when choosing the year to open on", () => {
    const thisYear = new Date().getFullYear();
    // A cycle that starts in December and ends in January belongs to this year
    // as far as the filter is concerned, so the default has to see it too - or
    // the list opens on a year that hides the only session there is.
    const straddling = session({
      id: "straddling",
      statementName: "straddling.csv",
      statementStart: `${thisYear - 1}-12-20`,
      statementEnd: `${thisYear}-01-19`,
    });
    renderList([straddling], { allYears: false });

    expect(screen.getByLabelText("Filter by statement year")).toHaveValue(String(thisYear));
    expect(screen.getByText("straddling.csv")).toBeInTheDocument();
  });

  it("preserves status, tag, and search filtering while exposing matches", () => {
    const { dubaiActive, dubaiApplied, hsbcApplied } = fixtures();
    renderList([dubaiActive, dubaiApplied, hsbcApplied], { grouped: true });

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

  it("lists sessions flat by default, with the account on the row", () => {
    const { dubaiActive, hsbcApplied } = fixtures();
    renderList([dubaiActive, hsbcApplied]);

    // No heading over a single row, and no indent under one.
    expect(screen.queryByRole("button", { name: `Collapse ${DUBAI} sessions` })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse all groups" })).toBeNull();
    // The account is on the row instead, so nothing is lost by not grouping.
    const table = screen.getByRole("table");
    expect(within(table).getByText(DUBAI)).toBeInTheDocument();
    expect(within(table).getByText(HSBC)).toBeInTheDocument();
    expect(within(table).getByText("dubai-active.csv")).toBeInTheDocument();
  });

  it("opens a session from the keyboard, not only by clicking its row", () => {
    const { dubaiActive } = fixtures();
    const { onOpen } = renderList([dubaiActive]);

    // A `tr` takes no focus and Enter does nothing on one, so the way in is a
    // real control that says what it opens.
    const open = screen.getByRole("button", { name: /Open the reconciliation for .* of dubai-active\.csv/ });
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledWith(dubaiActive);
  });

  it("offers a way out of filters that match nothing", () => {
    const { dubaiActive } = fixtures();
    renderList([dubaiActive]);

    fireEvent.change(screen.getByLabelText("Search reconciliation sessions"), {
      target: { value: "nothing matches this" },
    });
    expect(screen.getByText("No sessions match these filters.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all sessions" }));
    expect(screen.getByText("dubai-active.csv")).toBeInTheDocument();
  });

  it("names the statement's format beside its file name", () => {
    const { hsbcApplied } = fixtures();
    renderList([{ ...hsbcApplied, statementFormat: "pdf" }]);

    const statement = screen.getByText("hsbc-applied.csv").closest("td")!;
    expect(within(statement).getByText("pdf")).toBeInTheDocument();
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
