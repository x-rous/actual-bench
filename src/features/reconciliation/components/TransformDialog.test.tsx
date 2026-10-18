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
import { chooseSelectOption } from "@/components/ui/select.testing";

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
    expect(value.tagName).toBe("BUTTON");
    fireEvent.click(value);
    expect(screen.getByRole("option", { name: "#API" })).toBeInTheDocument();
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

    fireEvent.click(screen.getByLabelText("Value"));
    expect(screen.getByRole("option", { name: "#API" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "#PAYROLL" })).not.toBeInTheDocument();
  });
});

describe("replacing text in the notes", () => {
  it("is offered as an action", async () => {
    renderDialog();

    fireEvent.click(screen.getByLabelText("Action"));
    expect(await screen.findByRole("option", { name: "Replace text in notes" })).toBeInTheDocument();
  });

  /*
   * An empty needle is skipped by the transformation engine, so without this
   * the dialog called the rule complete and the preview reported "nothing
   * matches" - blaming the rows for a field the user had not filled in.
   */
  it("is not complete until there is something to replace", async () => {
    renderDialog();

    await chooseSelectOption(screen.getByLabelText("Action"), "Replace text in notes");

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

  it("counts whitespace as something to replace", async () => {
    // Collapsing a double space is a real rule; trimming the field would reject
    // it along with the empty one.
    renderDialog("#API  DANUBE");

    await chooseSelectOption(screen.getByLabelText("Action"), "Replace text in notes");
    fireEvent.change(screen.getByLabelText("Text to replace"), { target: { value: "  " } });

    expect(
      screen.queryByText("Fill in the rule above to see what it would change.")
    ).not.toBeInTheDocument();
  });
});


function renderPayeePreview(transactionOverrides: Partial<ActualTransactionSnapshot> = {}, itemOverrides: Partial<ReconciliationItem> = {}) {
  const entry = { ...item, ...itemOverrides };
  const transaction = entry.actualTransactionIds.length ? { ...txn("#API DANUBE"), ...transactionOverrides } : undefined;
  const onApply = jest.fn();
  const onClose = jest.fn();
  render(<TransformDialog items={[entry]} selectedIds={new Set()} payees={[{ id: "p1", name: "Danube" }, { id: "p2", name: "Neighbourhood Grocery" }]}
    categories={[]} onApply={onApply} onClose={onClose} contextFor={() => ({
      item: entry, statementRow, transaction,
      pending: prospectiveTransaction({ item: entry, statementRow, transaction, applyConfig: DEFAULT_APPLY_CONFIG }),
      payeeName: (id) => id === "p1" ? "Danube" : id === "p2" ? "Neighbourhood Grocery" : null,
      categoryName: () => null,
    })} />);
  return { onApply, onClose };
}

async function configurePayeeChange(name: string) {
  await chooseSelectOption(screen.getByLabelText("Field"), "Decision");
  await chooseSelectOption(screen.getByLabelText("Decision"), "Matched");
  await chooseSelectOption(screen.getByLabelText("Action"), "Set payee");
  await chooseSelectOption(screen.getByLabelText("Payee"), name);
}

it.each([
  ["p1", "Danube", "Danube"],
  ["p1", "Snapshot merchant", "Snapshot merchant"],
  [null, null, "No payee"],
  ["missing", null, "Unavailable payee"],
  ["historical", "Original merchant", "Original merchant"],
])("displays the payee name for %s but stages its ID", async (payeeId, payeeName, expectedBefore) => {
  const { onApply, onClose } = renderPayeePreview({ payeeId, payeeName });
  await configurePayeeChange("Neighbourhood Grocery");
  const table = screen.getByRole("table");
  expect(within(table).getByText(expectedBefore!)).toBeInTheDocument();
  expect(within(table).getByText("Neighbourhood Grocery")).toBeInTheDocument();
  expect(within(table).queryByText(/^(p1|p2|missing|historical)$/)).not.toBeInTheDocument();
  expect(within(table).getByText("15 Aug")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Change 1 row" }));
  expect(onApply).toHaveBeenCalledWith([{ itemId: "i1", patch: { payeeId: { original: payeeId, staged: "p2", source: "transform" } } }]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("explains a matched row that already has the requested value", async () => {
  renderPayeePreview();
  await configurePayeeChange("Danube");
  expect(screen.getByText("Matching rows already have these values.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change 0 rows" })).toBeDisabled();
});

it("explains protected rows without claiming that the conditions matched nothing", async () => {
  renderPayeePreview({}, { guards: { ...item.guards, protectedReconciled: true } });
  await configurePayeeChange("Neighbourhood Grocery");
  expect(screen.getByText("Matching rows are protected and cannot take these changes.")).toBeInTheDocument();
  expect(screen.getByText("1 left alone")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change 0 rows" })).toBeDisabled();
});

it("explains skipped manual edits and requires the existing override before staging them", async () => {
  const { onApply } = renderPayeePreview({}, { stagedChanges: { payeeId: { original: "p1", staged: "p2", source: "manual" } } });
  await configurePayeeChange("Danube");
  expect(screen.getByText("Matching rows have manual edits and were left unchanged.")).toBeInTheDocument();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Also change rows I edited by hand/ }));
  expect(screen.getByRole("button", { name: "Change 1 row" })).toBeEnabled();
});


it("shows the proposed bank payee before explicitly clearing a new row's payee", async () => {
  const { onApply } = renderPayeePreview({}, { disposition: "create", actualTransactionIds: [] });
  await chooseSelectOption(screen.getByLabelText("Field"), "Decision");
  await chooseSelectOption(screen.getByLabelText("Decision"), "Create in Actual");
  await chooseSelectOption(screen.getByLabelText("Action"), "Set payee");
  const cells = within(screen.getByRole("table")).getAllByRole("cell");
  expect(cells[2]).toHaveTextContent(statementRow.importedPayee);
  expect(cells[3]).toHaveTextContent("No payee");
  fireEvent.click(screen.getByRole("button", { name: "Change 1 row" }));
  expect(onApply).toHaveBeenCalledWith([{ itemId: "i1", patch: { payeeId: { original: null, staged: null, source: "transform" } } }]);
});
