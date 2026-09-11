/**
 * A month the budget does not have renders empty in the group row too - no
 * placeholder text and no not-allowed cursor. It is not an error state.
 */
import { render } from "@testing-library/react";
import { GroupMonthAggregate } from "./GroupRows";

let monthState: unknown;

jest.mock("../../context/MonthsDataContext", () => ({
  useEffectiveMonthFromContext: () => monthState,
}));

function renderAggregate() {
  return render(
    <GroupMonthAggregate
      month="2027-12"
      groupId="g1"
      cellView="budgeted"
      budgetMode="envelope"
      isReadOnlyMonth
    />
  );
}

describe("GroupMonthAggregate for a month the budget lacks", () => {
  afterEach(() => {
    monthState = undefined;
  });

  it("renders no placeholder text", () => {
    monthState = undefined;
    const { container } = renderAggregate();
    expect(container.textContent).toBe("");
  });

  it("does not mark the cell as forbidden", () => {
    monthState = undefined;
    const { container } = renderAggregate();
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.className).not.toContain("cursor-not-allowed");
    expect(cell).not.toHaveAttribute("aria-disabled");
  });

  it("still names the month for screen readers", () => {
    monthState = undefined;
    const { container } = renderAggregate();
    expect((container.firstElementChild as HTMLElement).getAttribute("aria-label")).toContain(
      "2027-12"
    );
  });
});
