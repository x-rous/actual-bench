import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import type { PostingOutputSnapshot, RowSnapshot } from "@/lib/assets-debt/services/snapshot";
import { PREVIEW_HEADER, PostingPreview } from "./PostingPreview";
import { renderPreviewRows, type PreviewDirectory } from "./renderPreviewRows";

/** T137: the preview of resulting Actual transactions (copy, rendering, accessibility, apply rules). */

const directory: PreviewDirectory = {
  accounts: [
    { id: "chk", name: "Everyday", offBudget: false, closed: false },
    { id: "loan", name: "Home loan", offBudget: true, closed: false },
  ],
  categories: [
    { id: "cat-loan", name: "Loan payments", groupName: "Bills", isIncome: false, hidden: false },
    { id: "cat-int", name: "Interest", groupName: "Bills", isIncome: false, hidden: false },
  ],
  payeeNames: { lender: "Home Lender" },
  transferAccountByPayee: { "tp-loan": "loan", "tp-chk": "chk" },
};

const row = (o: Partial<RowSnapshot>): RowSnapshot => ({
  id: "bank-1", accountId: "chk", date: "2024-02-01", amountMinor: -242915, payeeId: "lender", payeeName: "Home Lender", categoryId: null, notes: null,
  cleared: true, reconciled: false, importedId: "bank:1", importedPayee: "HOME LENDER", transferId: null, isParent: false, isChild: false, parentId: null, childCount: 0, ...o,
});

const meta = { format: "rd084.posting-output" as const, version: 1 as const };
const create: PostingOutputSnapshot = { ...meta, kind: "create", operations: [{ accountId: "loan", date: "2024-02-28", amountMinor: -387857, payeeId: null, transferAccountId: null, categoryId: "cat-int", notes: "Interest charge", cleared: false, importedId: "abdebt:x:g1", economicKind: "interest" }], accountBudgetStatus: { loan: "off-budget" }, components: [{ kind: "interest", amountMinor: 387857 }], closing: null };
const children = [
  { economicKind: "principal" as const, amountMinor: -41710, categoryId: "cat-loan", payeeId: "tp-loan", transferAccountId: "loan", notes: "Principal" },
  { economicKind: "interest" as const, amountMinor: -201205, categoryId: "cat-int", payeeId: "lender", transferAccountId: null, notes: "Interest" },
];
const restructure: PostingOutputSnapshot = { ...meta, kind: "restructure", before: row({}), operations: children, expectedPostState: { parentId: "bank-1", parentAmountMinor: -242915, children }, accountBudgetStatus: {}, components: [{ kind: "principal", amountMinor: 41710 }, { kind: "interest", amountMinor: 201205 }], closing: null };
const link: PostingOutputSnapshot = {
  ...meta, kind: "link",
  sourceBefore: row({ id: "child-1", amountMinor: -41710, categoryId: "cat-loan", notes: "Principal", isChild: true, parentId: "bank-1" }),
  counterpartBefore: row({ id: "lender-1", accountId: "loan", amountMinor: 41710, notes: "lender import", importedId: "lender:1", importedPayee: "LENDER" }),
  transferPayeeId: "tp-loan", expectedPairState: { sourceTransferId: "lender-1", counterpartTransferId: "child-1", counterpartAmountMinor: 41710 }, closing: null,
};

function posting(output: PostingOutputSnapshot, overrides: Partial<PostingView> = {}): PostingView {
  return {
    id: "p1", budgetSyncId: "b", subjectKind: "debt", subjectId: "d", postingKind: output.kind === "create" ? "interest-charge" : output.kind === "link" ? "repayment-link" : "repayment-split",
    periodKey: "2024-02-28", generation: 1, configRevision: 1, inputFormatVersion: 1, inputHash: "h", engineVersions: { projection: "projection@2", "loan-daily": "loan-daily@7" },
    classification: output.kind === "create" ? "safe" : "review", reasons: [{ code: "x", text: output.kind === "create" ? "Deterministic charge with unchanged inputs." : "Restructures an existing payment; confirm the split." }],
    idempotencyMarker: null, status: "proposed", decidedAt: null, appliedAt: null, actualIds: null, reversalOf: null, error: null, createdAt: "t", updatedAt: "t", output, ...overrides,
  };
}

describe("renderPreviewRows (pure)", () => {
  it("off-budget rows always show no category", () => {
    expect(renderPreviewRows(create, directory, 2)).toEqual([expect.objectContaining({ accountBudgetStatus: "off-budget", categoryName: null, amountMinor: -387857, payeeName: "" })]);
  });
  it("split: parent marked Split with the sum, children indented under it, and the transfer counterpart created in the loan", () => {
    const rows = renderPreviewRows(restructure, directory, 2);
    expect(rows.map((r) => [r.splitParent, r.splitChildOf, r.categoryName, r.amountMinor])).toEqual([
      [true, null, "Split", -242915],
      [false, "bank-1", "Loan payments", -41710],
      [false, "bank-1", "Interest", -201205],
      [false, null, null, 41710],
    ]);
    expect(rows[1].payeeName).toBe("Transfer: Home loan");
    expect(rows[3].payeeName).toBe("Transfer: Everyday");
    expect(renderPreviewRows(restructure, directory, 2, "before")).toHaveLength(1);
  });
  it("linked lender row: Linked chip, unchanged imported amount, and the transfer pair on both legs", () => {
    const rows = renderPreviewRows(link, directory, 2);
    expect(rows[0]).toMatchObject({ payeeName: "Transfer: Home loan", notes: "lender import", categoryName: "Loan payments" });
    expect(rows[1]).toMatchObject({ rowKind: "linked", linkedChip: true, amountMinor: 41710, payeeName: "Transfer: Everyday", categoryName: null });
  });
  it("amounts stay exact integer minor units", () => {
    for (const output of [create, restructure, link]) for (const r of renderPreviewRows(output, directory, 2)) expect(Number.isSafeInteger(r.amountMinor)).toBe(true);
  });
});

describe("PostingPreview", () => {
  it("shows the exact header, the three-state label as text, and the exact button labels", () => {
    render(<PostingPreview posting={posting(create)} directory={directory} currencyMinorDigits={2} onApply={jest.fn()} onDecline={jest.fn()} />);
    expect(screen.getByText(PREVIEW_HEADER)).toBeInTheDocument();
    expect(PREVIEW_HEADER).toBe("This is what Actual Bench will write to Actual.");
    expect(within(screen.getByRole("status")).getByText("Recommended - apply with one click")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply this change" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeEnabled();
  });

  it("a Review proposal says what to check; a Blocked one has no apply action and names the next step", () => {
    const { unmount } = render(<PostingPreview posting={posting(restructure)} directory={directory} currencyMinorDigits={2} />);
    expect(screen.getByText("Review before applying")).toBeInTheDocument();
    expect(screen.getByText("Check the split and the resulting rows before applying.")).toBeInTheDocument();
    unmount();
    render(<PostingPreview posting={posting(restructure, { classification: "blocked", reasons: [{ code: "reconciled-row", text: "The matched row is reconciled in Actual. Resolve in Actual, then re-run." }] })} directory={directory} currencyMinorDigits={2} actualRowHref={(id) => `https://actual.example/${id}`} />);
    expect(screen.getByText("Cannot apply - resolve in Actual first")).toBeInTheDocument();
    expect(screen.getByText("The matched row is reconciled in Actual. Resolve in Actual, then re-run.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply this change" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open the row in Actual" })).toHaveAttribute("href", "https://actual.example/bank-1");
  });

  it("Apply runs only on the user's click, exactly once; rendering calls nothing", () => {
    const onApply = jest.fn();
    render(<PostingPreview posting={posting(create)} directory={directory} currencyMinorDigits={2} onApply={onApply} onDecline={jest.fn()} />);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply this change" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("after apply: Applied on <date>, and Undo only opens a reversal proposal", () => {
    const onUndo = jest.fn();
    render(<PostingPreview posting={posting(create, { status: "applied", appliedAt: "2024-06-02T10:00:00.000Z", decidedAt: "2024-06-02T09:59:00.000Z" })} directory={directory} currencyMinorDigits={2} onUndo={onUndo} />);
    expect(screen.getByText(/Applied on 2024-06-02\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply this change" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo - opens a reversal proposal." }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("accessibility: row and column counts, labelled cells, keyboard-operable Before/After, no colour-only state, no em dash", () => {
    const { container } = render(<PostingPreview posting={posting(restructure)} directory={directory} currencyMinorDigits={2} />);
    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("aria-rowcount", "5");
    expect(table).toHaveAttribute("aria-colcount", "7");
    for (const cell of within(table).getAllByRole("cell")) expect(cell).toHaveAttribute("aria-label");
    const before = screen.getByRole("button", { name: "Before" });
    expect(before).toHaveAttribute("aria-pressed", "false");
    before.focus();
    fireEvent.click(before);
    expect(before).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "2");
    expect(container.textContent).not.toMatch(/—/);
  });

  it("an interrupted link offers Check Actual, and completion only after the read-only check asks for it", () => {
    const onCheck = jest.fn();
    const onCompleteLink = jest.fn();
    const { rerender } = render(<PostingPreview posting={posting(link, { status: "indeterminate", decidedAt: "t" })} directory={directory} currencyMinorDigits={2} onCheck={onCheck} onCompleteLink={onCompleteLink} />);
    expect(screen.queryByRole("button", { name: "Complete the transfer link" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check Actual" }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    rerender(<PostingPreview posting={posting(link, { status: "indeterminate", decidedAt: "t" })} directory={directory} currencyMinorDigits={2} onCheck={onCheck} onCompleteLink={onCompleteLink} completionDetail="The transfer link was interrupted halfway." />);
    fireEvent.click(screen.getByRole("button", { name: "Complete the transfer link" }));
    expect(onCompleteLink).toHaveBeenCalledTimes(1);
  });
});
