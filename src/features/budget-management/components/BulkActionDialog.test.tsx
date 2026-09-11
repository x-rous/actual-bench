/**
 * PR-055 added an optional percentage to the copy actions. The uplift default
 * belongs to the explicit "with a % change" action only: pre-filling it for
 * "Copy specific month" would silently change what that action has always
 * done, and a 5% shift is plausible enough to survive a glance at the preview.
 */
import { render, screen } from "@testing-library/react";
import { BulkActionDialog } from "./BulkActionDialog";
import type { BudgetCellSelection, LoadedCategory } from "../types";

const activeMonths = ["2026-01", "2026-02"];
const categories = [
  { id: "c1", name: "Groceries", groupId: "g1" },
] as unknown as LoadedCategory[];

const selection: BudgetCellSelection = {
  anchorMonth: "2026-01",
  anchorCategoryId: "c1",
  focusMonth: "2026-01",
  focusCategoryId: "c1",
};

function renderDialog(initialAction: Parameters<typeof BulkActionDialog>[0]["initialAction"]) {
  return render(
    <BulkActionDialog
      selection={selection}
      activeMonths={activeMonths}
      categories={categories}
      monthDataMap={{ "2026-01": [{ ...categories[0]!, budgeted: 1000 }] }}
      availableMonths={["2025-01", "2025-02", ...activeMonths]}
      ensureMonths={async () => ({ monthDataMap: {}, unavailable: [], failed: [] })}
      initialAction={initialAction}
      onClose={() => {}}
    />
  );
}

function percentageInput(): HTMLInputElement {
  return screen.getByLabelText(
    /percentage of the source value|percentage of current value/i
  ) as HTMLInputElement;
}

describe("BulkActionDialog percentage defaults", () => {
  it("defaults 'copy specific month' to an exact copy, not an uplift", () => {
    renderDialog("copy-from-month");
    expect(percentageInput().value).toBe("100");
  });

  it("defaults the explicit '% change' copy to 105", () => {
    renderDialog("copy-prior-year-same-month-pct");
    expect(percentageInput().value).toBe("105");
  });

  it("defaults apply-percentage to 100", () => {
    renderDialog("apply-percentage");
    expect(percentageInput().value).toBe("100");
  });

  it("offers source months from the whole budget file, grouped by year", () => {
    renderDialog("copy-from-month");
    const select = screen.getByLabelText("Source month") as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll("optgroup")).map((g) => g.label);
    expect(groups).toEqual(["2026", "2025"]);
    // Prior-year default: the same month one year before the selection.
    expect(select.value).toBe("2025-01");
  });
});
