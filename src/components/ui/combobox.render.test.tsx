import { fireEvent, render, screen } from "@testing-library/react";
import { MultiSearchableCombobox, type ComboboxOption } from "./combobox";

/**
 * The rendered behaviour of the multi-select, as opposed to the filtering
 * behind it.
 *
 * `filterGroupedOptions` decides which options belong in a result; the list
 * separately decides which of those the arrow keys can land on. Conflating the
 * two is what made a search matching only covered rows report "No results"
 * while the rows themselves were on screen - a bug no test of the filter could
 * have caught, because the filter was returning them correctly all along.
 */
const OPTIONS: ComboboxOption[] = [
  { id: "group:food", name: "Food & Groceries", isGroupHeader: true },
  { id: "category:groceries", name: "Groceries & Household" },
  { id: "category:restaurants", name: "Restaurants & Cafes" },
];

function open(props: Partial<React.ComponentProps<typeof MultiSearchableCombobox>> = {}) {
  render(
    <MultiSearchableCombobox
      options={OPTIONS}
      values={[]}
      onChange={() => {}}
      selectableGroups
      ariaLabel="Categories"
      {...props}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Categories" }));
  return screen.getByLabelText("Search options");
}

describe("MultiSearchableCombobox", () => {
  it("shows a covered row for a search only it matches", () => {
    /*
      The reproducing shape needs the *only* match to be a covered row. With
      selectable groups a matching child drags its heading in, and the heading
      is navigable - which is why the old code survived the obvious version of
      this test. Here the heading is a label, so the covered child is alone in
      the results and there is nothing for the keyboard to land on.
    */
    const search = open({
      selectableGroups: false,
      coveredIds: new Set(["category:restaurants"]),
    });
    fireEvent.change(search, { target: { value: "restaurants" } });

    expect(screen.getByText("Restaurants & Cafes")).toBeInTheDocument();
    expect(screen.queryByText("No results")).not.toBeInTheDocument();
  });

  it("still says so when a search matches nothing at all", () => {
    const search = open();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("leaves a covered row inert rather than letting it toggle", () => {
    const onChange = jest.fn();
    open({
      values: ["group:food"],
      coveredIds: new Set(["category:groceries"]),
      onChange,
    });
    fireEvent.click(screen.getByText("Groceries & Household"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies an exclusive option on its own, replacing whatever was selected", () => {
    const onChange = jest.fn();
    open({
      options: [{ id: "all:expenses", name: "All expenses", isGroupHeader: true }, ...OPTIONS],
      values: ["category:restaurants"],
      exclusiveIds: new Set(["all:expenses"]),
      onChange,
    });
    fireEvent.click(screen.getByText("All expenses"));
    expect(onChange).toHaveBeenCalledWith(["all:expenses"]);
  });
});
