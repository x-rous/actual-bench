import { render, screen } from "@testing-library/react";
import { MonthColumnHeader } from "./MonthColumnHeader";
import { currentMonth, addMonths } from "@/lib/budget/monthMath";

describe("MonthColumnHeader current-month highlight (F-079)", () => {
  const now = currentMonth();
  const other = addMonths(now, -3);

  it("marks the current month with aria-current and a non-color weight cue", () => {
    render(<MonthColumnHeader month={now} availableMonths={[now]} />);
    const header = screen.getByLabelText(/current month/i);
    expect(header).toHaveAttribute("aria-current", "date");
    // Non-color signal: bold weight (not just an accent colour).
    expect(header.className).toMatch(/font-bold/);
  });

  it("does not mark a non-current month", () => {
    render(<MonthColumnHeader month={other} availableMonths={[other]} />);
    const header = screen.getByLabelText(/^Month:/);
    expect(header).not.toHaveAttribute("aria-current");
    expect(header.getAttribute("aria-label")).not.toMatch(/current month/i);
  });
});
