import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { ChangeList, type ChangeActions } from "./ChangeList";
import { buildChangeRows, countByFilter, rowsFor } from "./changeRows";
import { LoanStatusStrip } from "./LoanStatusStrip";
import { WorkspaceFrame, workspaceTabFor } from "./WorkspaceFrame";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: jest.fn() }) }));
jest.mock("../../lib/postingsApi", () => ({ reproducePosting: jest.fn() }));

const directory = { accounts: [{ id: "chk", name: "Everyday", offBudget: false, closed: false }, { id: "loan", name: "Home loan", offBudget: true, closed: false }], categories: [{ id: "cat-int", name: "Interest", groupName: "Bills", isIncome: false, hidden: false }], transferAccountByPayee: { "tp-loan": "loan" } };
const row = (o: Record<string, unknown> = {}) => ({ id: "bank", accountId: "chk", date: "2024-01-29", amountMinor: -242915, payeeId: null, payeeName: "Home Lender", categoryId: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0, ...o });
const children = [
  { economicKind: "principal", amountMinor: -41710, categoryId: null, payeeId: "tp-loan", transferAccountId: "loan", notes: "Principal" },
  { economicKind: "interest", amountMinor: -201205, categoryId: "cat-int", payeeId: null, transferAccountId: null, notes: "Interest" },
];
const split = { format: "rd084.posting-output", version: 1, kind: "restructure", before: row(), operations: children, expectedPostState: { parentId: "bank", parentAmountMinor: -242915, children }, accountBudgetStatus: {}, components: [{ kind: "principal", amountMinor: 41710 }, { kind: "interest", amountMinor: 201205 }], closing: null };

function posting(id: string, patch: Partial<PostingView> = {}): PostingView {
  return {
    id, budgetSyncId: "b", subjectKind: "debt", subjectId: "d", postingKind: "repayment-split", periodKey: "2024-02-01", generation: 1, configRevision: 3, inputFormatVersion: 2, inputHash: "h",
    engineVersions: { projection: "projection@2" }, classification: "review", reasons: [{ code: "restructures-existing-payment", text: "Restructures an existing payment; confirm the split." }, { code: "drift-material", text: "drift reason" }],
    idempotencyMarker: null, status: "proposed", decidedAt: null, appliedAt: null, actualIds: null, reversalOf: null, error: null, createdAt: "2024-06-01T00:00:00Z", updatedAt: "2024-06-01T00:00:00Z",
    output: split as never, basis: { allocation: "accrued-to-due-date", dueDate: "2024-02-01", paidDate: "2024-01-29", assumedEarlier: 0 }, ...patch,
  } as PostingView;
}

function actions(): ChangeActions & Record<string, jest.Mock> {
  return { apply: jest.fn(), decline: jest.fn(), undo: jest.fn(), check: jest.fn(), complete: jest.fn(), edit: jest.fn(), editApply: jest.fn() } as never;
}

function List({ postings, filter = "action", act = actions(), expanded = new Set<string>(), selected = new Set<string>(), onToggle = jest.fn() }: { postings: PostingView[]; filter?: "action" | "all" | "applied"; act?: ChangeActions; expanded?: Set<string>; selected?: Set<string>; onToggle?: jest.Mock }) {
  const all = buildChangeRows(postings);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ChangeList rows={rowsFor(all, filter)} filter={filter} onFilter={jest.fn()} counts={countByFilter(all)} selected={selected} onToggle={onToggle} onToggleAll={jest.fn()} expanded={expanded} onExpand={jest.fn()} directory={directory as never} digits={2} busy={false} actions={act} completion={{}} stepNote={() => null} />
    </QueryClientProvider>
  );
}

describe("Activity list (T289)", () => {
  it("one table with filter chips; a row shows due, paid, payment, now and only what changes; nothing runs without a click", () => {
    const act = actions();
    const { container } = render(<List postings={[posting("p1")]} act={act} />);
    expect(screen.getByRole("group", { name: "Filter changes" })).toHaveTextContent("Needs action 1");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["", "Due", "Paid", "Payment", "Now", "After", "Status", "Details"]);
    expect(within(table).getByRole("rowheader")).toHaveTextContent(/Feb/);
    expect(table).toHaveTextContent("Uncategorized");
    expect(table).toHaveTextContent("Principal 417.10 · Interest 2,012.05");
    expect(Object.values(act).every((fn) => (fn as jest.Mock).mock.calls.length === 0)).toBe(true);
    expect(container.textContent).not.toContain("—");
  });

  it("a Blocked row has no checkbox and says why in its status", () => {
    render(<List postings={[posting("b1", { classification: "blocked", reasons: [{ code: "reconciled-row", text: "The matched row is reconciled in Actual." }] })]} />);
    expect(screen.queryByRole("checkbox", { name: /^Select Repayment split/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select all available changes" })).toBeDisabled();
    expect(screen.getByText(/Blocked: The matched row is reconciled/)).toBeInTheDocument();
  });

  it("expanded: the split's amounts in place, one line of context, one now-to-after table of the exact Actual rows, and Apply on click", () => {
    const act = actions();
    render(<List postings={[posting("p1")]} act={act} expanded={new Set(["proposed:repayment-split:2024-02-01"])} />);
    expect(screen.getByLabelText("Principal")).toHaveValue("417.10");
    expect(screen.getByLabelText("Interest")).toHaveValue("2,012.05");
    expect(screen.getByText(/disagree by more than your tolerance/)).toBeInTheDocument();
    expect(screen.getByText(/Interest to the due date .*Paid 3 days early/)).toBeInTheDocument();
    const exact = screen.getByRole("table", { name: "Exact Actual transactions" });
    const lines = within(exact).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(lines).toEqual([
      ["Everyday", "Home Lender", "- → Split", "", "-2,429.15", "-2,429.15", "Becomes a split"],
      ["", "Transfer: Home loan", "", "Principal", "-", "-417.10", "New part"],
      ["", "Home Lender", "Interest", "Interest", "-", "-2,012.05", "New part"],
      ["Home loan", "Transfer: Everyday", "", "Principal", "-", "417.10", "New"],
    ]);
    expect(screen.getByText("Dates and cleared status stay the same.")).toBeInTheDocument();
    expect(screen.queryByLabelText("How it was calculated")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "How it was calculated" }));
    expect(screen.getByLabelText("How it was calculated")).toHaveTextContent(/early-payment benefit next time/);
    fireEvent.click(screen.getByRole("button", { name: "Hide exact Actual transactions" }));
    expect(screen.queryByRole("table", { name: "Exact Actual transactions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply this change" }));
    expect(act.apply).toHaveBeenCalledTimes(1);
    expect(act.editApply).not.toHaveBeenCalled();
  });

  it("Undo turns the applied row itself into Undo pending with Apply undo and Cancel", () => {
    const act = actions();
    const applied = posting("a1", { status: "applied", appliedAt: "2024-06-02T00:00:00Z" });
    const { rerender } = render(<List postings={[applied]} filter="applied" act={act} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(act.undo).toHaveBeenCalledWith(applied);
    const undo = posting("u1", { postingKind: "reversal", periodKey: "a1", reversalOf: "a1", output: { kind: "restore-split" } as never });
    rerender(<List postings={[applied, undo]} act={act} />);
    expect(screen.getByText("Undo pending")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(act.apply).toHaveBeenCalledWith(undo);
    expect(act.decline).toHaveBeenCalledWith(undo);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("the amounts edit in place: either field moves the other; ±0.01 needs no reason; more shows a required reason; Apply with edit records and applies in one click", () => {
    const act = actions();
    render(<List postings={[posting("p1")]} act={act} expanded={new Set(["proposed:repayment-split:2024-02-01"])} />);
    expect(screen.queryByRole("button", { name: "Save edit" })).toBeNull();
    const interest = screen.getByLabelText("Interest");
    fireEvent.change(interest, { target: { value: "2012.06" } });
    fireEvent.blur(interest);
    expect(screen.getByLabelText("Principal")).toHaveValue("417.09");
    expect(screen.queryByLabelText(/^Reason/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply with edit" }));
    expect(act.editApply).toHaveBeenLastCalledWith(expect.objectContaining({ id: "p1" }), 201206, null);
    const principal = screen.getByLabelText("Principal");
    fireEvent.change(principal, { target: { value: "409.15" } });
    fireEvent.blur(principal);
    expect(screen.getByLabelText("Interest")).toHaveValue("2,020.00");
    expect(screen.getByRole("button", { name: "Apply with edit" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Give a short reason/);
    fireEvent.change(screen.getByLabelText("Reason (needed for a change over one minor unit)"), { target: { value: "Statement shows 2,020.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    expect(act.edit).toHaveBeenLastCalledWith(expect.objectContaining({ id: "p1" }), 202000, "Statement shows 2,020.00");
    fireEvent.click(screen.getByRole("button", { name: "Reset to calculated" }));
    expect(screen.getByLabelText("Interest")).toHaveValue("2,012.05");
    expect(screen.getByRole("button", { name: "Apply this change" })).toBeEnabled();
  });
});

describe("a split already in Actual, edited in place (T314)", () => {
  const parent = row({ isParent: true, childCount: 2 });
  const principal = row({ id: "c-p", amountMinor: -40000, payeeId: "tp-loan", transferId: "loan-row", isChild: true, parentId: "bank", notes: "Principal" });
  const interestLine = row({ id: "c-i", amountMinor: -202915, categoryId: "cat-int", isChild: true, parentId: "bank", notes: "Interest" });
  const recordedSplit = { parent, children: [principal, interestLine], principalMinor: 40000, interestMinor: 202915, calculatedInterestMinor: 201205, counterpart: row({ id: "loan-row", accountId: "loan", amountMinor: 40000, transferId: "c-p" }) };
  const claim = { format: "rd084.posting-output", version: 1, kind: "claim", rows: [principal], role: "repayment", closing: null, recordedSplit };

  it("starts from Actual's figures; Reset to calculated says the split in Actual changes; Keep Actual's amounts goes back", () => {
    const act = actions();
    render(<List postings={[posting("r1", { output: claim as never })]} act={act} expanded={new Set(["proposed:repayment-split:2024-02-01"])} />);
    expect(screen.getByLabelText("Interest")).toHaveValue("2,029.15");
    expect(screen.getByLabelText("Principal")).toHaveValue("400.00");
    // Actual's own figure needs no reason, though it is far from Bench's.
    expect(screen.queryByLabelText(/^Reason/)).toBeNull();
    expect(screen.getByRole("button", { name: "Apply this change" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset to calculated" }));
    expect(screen.getByLabelText("Interest")).toHaveValue("2,012.05");
    expect(screen.getByText(/Actual has 2,029.15; applying changes the split in Actual/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply with edit" }));
    expect(act.editApply).toHaveBeenLastCalledWith(expect.objectContaining({ id: "r1" }), 201205, null);
    fireEvent.click(screen.getByRole("button", { name: "Keep Actual's amounts" }));
    expect(screen.getByLabelText("Interest")).toHaveValue("2,029.15");
    expect(screen.getByRole("button", { name: "Apply this change" })).toBeEnabled();
  });
});

describe("Workspace frame (T288)", () => {
  it("has exactly three tabs and a back link that names where it goes", () => {
    const onTab = jest.fn();
    push.mockClear();
    render(<WorkspaceFrame title="HSBC" state="Saved · revision 3" tab="activity" onTab={onTab} dirty={false}><p>body</p></WorkspaceFrame>);
    const nav = screen.getByRole("navigation", { name: "Loan sections" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Terms & Schedule", "Link to Actual", "Sync Repayments"]);
    fireEvent.click(within(nav).getByRole("button", { name: "Link to Actual" }));
    expect(onTab).toHaveBeenCalledWith("setup");
    fireEvent.click(screen.getByRole("button", { name: /Loans & Debt/ }));
    expect(push).toHaveBeenCalledWith("/loans");
  });

  it("leaving with unsaved changes asks: Stay, Discard changes, or Save and leave", async () => {
    push.mockClear();
    const save = jest.fn(async () => true);
    render(<WorkspaceFrame title="HSBC" state="Unsaved changes" tab="calculation" onTab={jest.fn()} dirty onSaveAndLeave={save}><p>body</p></WorkspaceFrame>);
    fireEvent.click(screen.getByRole("button", { name: /Loans & Debt/ }));
    expect(await screen.findByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/loans"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("old links open the tab that now holds their content", () => {
    expect(workspaceTabFor("simulator", "activity")).toBe("calculation");
    expect(workspaceTabFor("tracking", "activity")).toBe("setup");
    expect(workspaceTabFor("matching", "activity")).toBe("setup");
    expect(workspaceTabFor(null, "activity")).toBe("activity");
    expect(workspaceTabFor("nonsense", "calculation")).toBe("calculation");
  });
});

describe("the Transactions status strip (T305)", () => {
  it("keeps Refresh from Actual visible and shows the repayments, the next payment, the last match, the gap and matching", () => {
    const onRefresh = jest.fn();
    const status = { at: new Date().toISOString(), comparisonDate: "2026-10-05", actualMinor: 10_487_947, modelMinor: 10_523_611, lenderMinor: null, lenderDate: null, modelVsActualMinor: -35_664, actualVsLenderMinor: null, drift: "material", reconciliationOverdue: false };
    const cells = [{ date: "2026-09-01", state: "applied" as const }, { date: "2026-10-01", state: "edited" as const }, { date: "2026-11-02", state: "next" as const }];
    render(
      <LoanStatusStrip
        refresh={{ phase: "done", error: null, status, statusFromCache: false, notices: [], driftMaterial: true, driftExplained: false, unscheduled: [], paymentOptions: [], repaymentChoices: [] }}
        counts={{ review: 0, notApplied: 0 }}
        digits={2}
        onRefresh={onRefresh}
        onStatements={jest.fn()}
        matching={{ cells, facts: { due: 2, done: 2, upcoming: 1, edited: 1, missing: 0, notApplied: 0, next: { date: "2026-11-02", amountMinor: 837_957 }, lastMatched: { paidDate: "2026-09-25", dueDate: "2026-10-01" }, averageEarlyDays: 6 }, accountName: "HSBC Main Account", window: { before: 12, after: 3 }, ruleOn: true, lastCheck: "Last check: 0 found, 35 already handled, 0 missing", unrecordedExtra: 0 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh from Actual" }));
    expect(onRefresh).toHaveBeenCalled();
    expect(screen.getByRole("img", { name: /3 repayments: 1 applied, 1 applied with your edit, 1 upcoming/ })).toBeInTheDocument();
    expect(screen.getByText("2 of 2 applied")).toBeInTheDocument();
    expect(screen.getByText("1 upcoming")).toBeInTheDocument();
    expect(screen.getByText("from HSBC Main Account")).toBeInTheDocument();
    expect(screen.getByTitle("Payments from HSBC Main Account, 12 days early to 3 late")).toBeInTheDocument();
    expect(screen.getByText("6 days early on average")).toBeInTheDocument();
    expect(screen.getByText("1 split applied with your edit")).toBeInTheDocument();
    expect(screen.getByText("Rule on")).toBeInTheDocument();
  });
});
