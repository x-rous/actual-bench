"use client";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_APPLY_CONFIG } from "@/lib/reconciliation/session/plan";
import { prospectiveTransaction } from "@/lib/reconciliation/session/prospective";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { TransformDialog } from "./TransformDialog";

function txn(notes: string | null): ActualTransactionSnapshot {
  return {
    id: "t1",
    accountId: "acct-1",
    date: "2026-08-15",
    amount: -1730,
    payeeId: "p1",
    payeeName: "Danube",
    importedPayee: null,
    categoryId: "c1",
    categoryName: "Groceries",
    notes,
    cleared: true,
    reconciled: false,
    importedId: null,
    transferId: null,
    scheduleId: null,
    isParent: false,
    isChild: false,
    parentId: null,
    splitLines: [],
  };
}

const statementRow: StatementRow = {
  id: "s1",
  sourceRowNumber: 1,
  postedDate: "2026-08-15",
  amount: -1730,
  importedPayee: "DANUBE Ma MAKKAH SAU",
  raw: {},
  fingerprint: "fp-s1",
};

const item: ReconciliationItem = {
  id: "i1",
  statementRowIds: ["s1"],
  actualTransactionIds: ["t1"],
  disposition: "matched",
  guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
};

function renderDialog(notes: string | null = "#API DANUBE Makkah") {
  const transaction = txn(notes);
  render(
    <TransformDialog
      items={[item]}
      selectedIds={new Set()}
      contextFor={() => ({
        item,
        statementRow,
        transaction,
        pending: prospectiveTransaction({
          item,
          statementRow,
          transaction,
          applyConfig: DEFAULT_APPLY_CONFIG,
        }),
        payeeName: () => "Danube",
        categoryName: () => "Groceries",
      })}
      payees={[{ id: "p1", name: "Danube" }]}
      categories={[{ id: "c1", name: "Groceries" }]}
      onClose={() => {}}
      onApply={() => {}}
    />
  );
}

/** Several rows, with only some of them selected, so scope is observable. */
function renderScoped(rows: { id: string; notes: string }[], selected: string[]) {
  const items = rows.map((entry) => ({ ...item, id: entry.id }));
  const notesById = new Map(rows.map((entry) => [entry.id, entry.notes]));

  render(
    <TransformDialog
      items={items}
      selectedIds={new Set(selected)}
      contextFor={(entry: ReconciliationItem) => {
        const transaction = txn(notesById.get(entry.id) ?? null);
        return {
          item: entry,
          statementRow,
          transaction,
          pending: prospectiveTransaction({
            item: entry,
            statementRow,
            transaction,
            applyConfig: DEFAULT_APPLY_CONFIG,
          }),
          payeeName: () => "Danube",
          categoryName: () => "Groceries",
        };
      }}
      payees={[{ id: "p1", name: "Danube" }]}
      categories={[{ id: "c1", name: "Groceries" }]}
      onClose={() => {}}
      onApply={() => {}}
    />
  );
}

/*
 * A condition compares literally, so a value typed one character out matches
 * nothing and says nothing about why. Where the value has to name something
 * that already exists, it is chosen.
 */
describe("choosing a condition's value rather than typing it", () => {
  it("offers the tags the rows actually carry", () => {
    renderDialog("#API DANUBE Makkah");

    // The default condition is "notes hasTag", so the picker is already shown.
    const value = screen.getByLabelText("Value");
    expect(value.tagName).toBe("SELECT");
    expect(within(value as HTMLSelectElement).getByRole("option", { name: "#API" })).toBeInTheDocument();
  });

  it("falls back to a plain field when the rows carry no tags", () => {
    // A picker with nothing in it would leave the rule unanswerable, with no
    // indication why.
    renderDialog("DANUBE Makkah, no tags here");

    expect(screen.getByLabelText("Value").tagName).toBe("INPUT");
  });
});

/*
 * The new action, and the reason it is not `replaceTag`: that one knows what a
 * tag is. This is for the words the bank wrote, which are not a list anyone
 * holds - so both halves stay typed.
 */
/*
 * Scoped to "the N selected", a tag found only on unselected rows is a choice
 * that silently matches nothing - and every consumer of this list (conditions,
 * replaceTag's source, removeTag) needs a tag the rows actually carry.
 */
describe("the tags offered when the rule is scoped to a selection", () => {
  it("leaves out tags no selected row has", () => {
    renderScoped(
      [
        { id: "i1", notes: "#API DANUBE" },
        { id: "i2", notes: "#PAYROLL SALARY" },
      ],
      ["i1"]
    );

    const value = screen.getByLabelText("Value");
    expect(within(value as HTMLSelectElement).getByRole("option", { name: "#API" })).toBeInTheDocument();
    expect(
      within(value as HTMLSelectElement).queryByRole("option", { name: "#PAYROLL" })
    ).not.toBeInTheDocument();
  });
});

describe("replacing text in the notes", () => {
  it("is offered as an action", () => {
    renderDialog();

    const action = screen.getByLabelText("Action");
    expect(
      within(action as HTMLSelectElement).getByRole("option", { name: "Replace text in notes" })
    ).toBeInTheDocument();
  });

  /*
   * An empty needle is skipped by the transformation engine, so without this
   * the dialog called the rule complete and the preview reported "nothing
   * matches" - blaming the rows for a field the user had not filled in.
   */
  it("is not complete until there is something to replace", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "replaceNoteText" },
    });

    // An incomplete rule is told so. Calling it complete and reporting
    // "nothing matches" blames the rows for a field nobody filled in.
    expect(screen.getByText("Fill in the rule above to see what it would change.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Text to replace"), {
      target: { value: "DANUBE" },
    });
    expect(
      screen.queryByText("Fill in the rule above to see what it would change.")
    ).not.toBeInTheDocument();
  });

  it("counts whitespace as something to replace", () => {
    // Collapsing a double space is a real rule; trimming the field would reject
    // it along with the empty one.
    renderDialog("#API  DANUBE");

    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "replaceNoteText" },
    });
    fireEvent.change(screen.getByLabelText("Text to replace"), { target: { value: "  " } });

    expect(
      screen.queryByText("Fill in the rule above to see what it would change.")
    ).not.toBeInTheDocument();
  });
});
