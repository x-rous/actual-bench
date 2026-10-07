import { render, screen, within } from "@testing-library/react";
import type { PostingOutputSnapshot, RowSnapshot } from "@/lib/assets-debt/services/snapshot";
import { PREVIEW_HEADER, PreviewTable } from "./PreviewTable";
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

describe("PreviewTable", () => {
  it("accessibility: row and column counts, labelled cells, the Split parent, no colour-only state, no em dash", () => {
    const rows = renderPreviewRows(restructure, directory, 2);
    const { container } = render(<PreviewTable rows={rows} label="Repayment split rows, after" />);
    const table = screen.getByRole("table", { name: "Repayment split rows, after" });
    expect(table).toHaveAttribute("aria-rowcount", String(rows.length + 1));
    expect(table).toHaveAttribute("aria-colcount", "7");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Date", "Account", "Payee", "Category", "Notes", "Amount", "Status"]);
    expect(within(table).getAllByLabelText(/^Category: Split$/)).toHaveLength(1);
    expect(within(table).getAllByLabelText(/^Status: /).length).toBe(rows.length);
    expect(container.textContent).not.toContain("\u2014");
    expect(PREVIEW_HEADER).toBe("This is what Actual Bench will write to Actual.");
  });

  it("says when there are no existing rows", () => {
    render(<PreviewTable rows={[]} label="none" />);
    expect(screen.getByText(/No existing rows/)).toBeInTheDocument();
  });
});
