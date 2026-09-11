/**
 * PR-055 added an optional percentage to the copy actions. The uplift default
 * belongs to the explicit "with a % change" action only: pre-filling it for
 * "Copy specific month" would silently change what that action has always
 * done, and a 5% shift is plausible enough to survive a glance at the preview.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { BulkActionDialog } from "./BulkActionDialog";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import type { LoadedCategory } from "../types";

const activeMonths = ["2026-01", "2026-02"];
const categories = [
  { id: "c1", name: "Groceries", groupId: "g1" },
] as unknown as LoadedCategory[];

const targetCells = [{ month: "2026-01", categoryId: "c1" }];
const twoCategories = [
  { id: "c1", name: "Groceries", groupId: "g1", groupName: "Everyday" },
  { id: "c2", name: "Rent", groupId: "g2", groupName: "Housing" },
] as unknown as LoadedCategory[];
const twoCells = [
  { month: "2026-01", categoryId: "c1" },
  { month: "2026-01", categoryId: "c2" },
];

function renderDialog(initialAction: Parameters<typeof BulkActionDialog>[0]["initialAction"]) {
  return render(
    <BulkActionDialog
      targetCells={targetCells}
      activeMonths={activeMonths}
      categories={categories}
      monthDataMap={{ "2026-01": [{ ...categories[0]!, budgeted: 1000 }] }}
      availableMonths={["2025-01", "2025-02", ...activeMonths]}
      ensureMonths={async () => ({
        // The prior-year source the copy actions read.
        monthDataMap: { "2025-01": [{ ...categories[0]!, budgeted: 5000 }] },
        unavailable: [],
        failed: [],
      })}
      initialAction={initialAction}
      onClose={() => {}}
    />
  );
}

function renderDialogWithContainer(
  initialAction: Parameters<typeof BulkActionDialog>[0]["initialAction"]
) {
  return render(
    <BulkActionDialog
      targetCells={targetCells}
      activeMonths={activeMonths}
      categories={categories}
      monthDataMap={{ "2026-01": [{ ...categories[0]!, budgeted: 1000 }] }}
      availableMonths={["2025-01", "2025-02", ...activeMonths]}
      ensureMonths={async () => ({
        monthDataMap: { "2025-01": [{ ...categories[0]!, budgeted: 5000 }] },
        unavailable: [],
        failed: [],
      })}
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

describe("BulkActionDialog step skipping", () => {
  it("goes straight to the preview for an action that collects nothing", async () => {
    renderDialog("copy-prior-year-same-month");
    // No parameter form to click through - the preview is the confirmation.
    expect(await screen.findByText(/will be updated/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Preview changes/i })).not.toBeInTheDocument();
  });

  it("offers Cancel rather than Back, so there is no empty form to return to", async () => {
    renderDialog("copy-prior-year-same-month");
    await screen.findByText(/will be updated/);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("still shows the parameter step when the action needs a value", () => {
    renderDialog("set-fixed");
    expect(screen.getByLabelText(/Fixed amount in dollars/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview changes/i })).toBeInTheDocument();
  });
});

// ─── Editing the previewed numbers ────────────────────────────────────────────

/**
 * An average lands on 97 when the user wanted 100. The preview is the list of
 * numbers about to be written, so those numbers are what should be editable -
 * and what gets applied.
 */
describe("BulkActionDialog row editing", () => {
  beforeEach(() => {
    useBudgetEditsStore.getState().discardAll();
  });

  async function openPreview() {
    renderDialog("copy-prior-year-same-month");
    await screen.findByText(/will be updated/);
    return screen.getByLabelText(/New amount for Groceries/i) as HTMLInputElement;
  }

  it("shows the calculated amount, editable", async () => {
    const input = await openPreview();
    expect(input.value).toBe("50.00"); // the 5000 minor units from the source
  });

  it("applies the edited amount rather than the calculated one", async () => {
    const input = await openPreview();
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: /Apply 1 budget change/i }));

    const edits = useBudgetEditsStore.getState().edits;
    expect(edits["2026-01:c1"]?.nextBudgeted).toBe(10000);
  });

  it("reverts an adjusted row to the calculated amount", async () => {
    const input = await openPreview();
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.blur(input);
    expect(screen.getByText(/1 manually adjusted/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Revert Groceries/i));
    expect((screen.getByLabelText(/New amount for Groceries/i) as HTMLInputElement).value).toBe(
      "50.00"
    );
    expect(screen.queryByText(/manually adjusted/)).not.toBeInTheDocument();
  });

  it("discards text that is not a number", async () => {
    const input = await openPreview();
    fireEvent.change(input, { target: { value: "not a number" } });
    fireEvent.blur(input);
    expect((screen.getByLabelText(/New amount for Groceries/i) as HTMLInputElement).value).toBe(
      "50.00"
    );
  });

  it("accepts an arithmetic expression, like the grid cells do", async () => {
    const input = await openPreview();
    fireEvent.change(input, { target: { value: "50 * 2" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: /Apply 1 budget change/i }));
    expect(useBudgetEditsStore.getState().edits["2026-01:c1"]?.nextBudgeted).toBe(10000);
  });

  it("abandons an in-progress edit on Escape", async () => {
    const input = await openPreview();
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect((screen.getByLabelText(/New amount for Groceries/i) as HTMLInputElement).value).toBe(
      "50.00"
    );
  });

  it("keeps the net change in step with the edits", async () => {
    const input = await openPreview();
    // Current is 1000 minor (10.00); calculated new is 5000 (50.00).
    expect(screen.getByText("Net change").parentElement?.textContent).toContain("40.00");
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.blur(input);
    expect(screen.getByText("Net change").parentElement?.textContent).toContain("10.00");
  });

  it("keeps the visible header outside the scrolling area", async () => {
    const { container } = renderDialogWithContainer("copy-prior-year-same-month");
    await screen.findByText(/will be updated/);

    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    // The header must not scroll with the rows - otherwise the scrollbar runs
    // the full height beside it, and a translucent header shows rows through.
    const visibleHeader = container.querySelector('table[aria-hidden="true"]');
    expect(visibleHeader).not.toBeNull();
    expect(visibleHeader!.textContent).toContain("Group");
    expect(scroller!.contains(visibleHeader!)).toBe(false);
    // The scrolling table still describes its own columns for screen readers.
    expect(scroller!.querySelector("thead.sr-only")).not.toBeNull();
  });
});

describe("BulkActionDialog keyboard navigation", () => {
  function renderTwoRows() {
    render(
      <BulkActionDialog
        targetCells={twoCells}
        activeMonths={activeMonths}
        categories={twoCategories}
        monthDataMap={{
          "2026-01": [
            { ...twoCategories[0]!, budgeted: 1000 },
            { ...twoCategories[1]!, budgeted: 2000 },
          ],
        }}
        availableMonths={["2025-01", ...activeMonths]}
        ensureMonths={async () => ({
          monthDataMap: {
            "2025-01": [
              { ...twoCategories[0]!, budgeted: 5000 },
              { ...twoCategories[1]!, budgeted: 7000 },
            ],
          },
          unavailable: [],
          failed: [],
        })}
        initialAction="copy-prior-year-same-month"
        onClose={() => {}}
      />
    );
  }

  it("moves down a row on ArrowDown", async () => {
    renderTwoRows();
    await screen.findByText(/will be updated/);
    const first = screen.getByLabelText(/New amount for Groceries/i);
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByLabelText(/New amount for Rent/i));
  });

  it("moves back up on ArrowUp", async () => {
    renderTwoRows();
    await screen.findByText(/will be updated/);
    const second = screen.getByLabelText(/New amount for Rent/i);
    second.focus();
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByLabelText(/New amount for Groceries/i));
  });

  it("commits the edit when moving away with an arrow", async () => {
    renderTwoRows();
    await screen.findByText(/will be updated/);
    const first = screen.getByLabelText(/New amount for Groceries/i) as HTMLInputElement;
    fireEvent.change(first, { target: { value: "123" } });
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect((screen.getByLabelText(/New amount for Groceries/i) as HTMLInputElement).value).toBe(
      "123.00"
    );
  });

  it("stays put at the ends rather than losing focus", async () => {
    renderTwoRows();
    await screen.findByText(/will be updated/);
    const first = screen.getByLabelText(/New amount for Groceries/i);
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });
});

describe("BulkActionDialog table readability", () => {
  function renderTwoRows() {
    render(
      <BulkActionDialog
        targetCells={twoCells}
        activeMonths={activeMonths}
        categories={twoCategories}
        monthDataMap={{
          "2026-01": [
            { ...twoCategories[0]!, budgeted: 1000 },
            { ...twoCategories[1]!, budgeted: 2000 },
          ],
        }}
        availableMonths={["2025-01", ...activeMonths]}
        ensureMonths={async () => ({
          monthDataMap: {
            "2025-01": [
              { ...twoCategories[0]!, budgeted: 5000 },
              { ...twoCategories[1]!, budgeted: 7000 },
            ],
          },
          unavailable: [],
          failed: [],
        })}
        initialAction="copy-prior-year-same-month"
        onClose={() => {}}
      />
    );
  }

  it("names each row's category group", async () => {
    renderTwoRows();
    await screen.findByText(/will be updated/);
    expect(screen.getByRole("columnheader", { name: "Group" })).toBeInTheDocument();
    expect(screen.getByText("Everyday")).toBeInTheDocument();
    expect(screen.getByText("Housing")).toBeInTheDocument();
  });

  it("drops the Month column when every row is in the same month", async () => {
    renderTwoRows();
    await screen.findByText(/will be updated/);
    // One month in the preview: repeating it on every row is noise.
    expect(screen.queryByRole("columnheader", { name: "Month" })).not.toBeInTheDocument();
  });

  it("reverts every adjustment at once", async () => {
    renderTwoRows();
    await screen.findByText(/will be updated/);
    const first = screen.getByLabelText(/New amount for Groceries/i) as HTMLInputElement;
    const second = screen.getByLabelText(/New amount for Rent/i) as HTMLInputElement;
    fireEvent.change(first, { target: { value: "1" } });
    fireEvent.blur(first);
    fireEvent.change(second, { target: { value: "2" } });
    fireEvent.blur(second);
    expect(screen.getByText(/2 manually adjusted/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.queryByText(/manually adjusted/)).not.toBeInTheDocument();
    expect((screen.getByLabelText(/New amount for Groceries/i) as HTMLInputElement).value).toBe("50.00");
  });
});

