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

  it("includes the elapsed day-of-month in the current-month accessible name (RD-067)", () => {
    render(<MonthColumnHeader month={now} availableMonths={[now]} />);
    // e.g. "... (current month, day 12 of 31)"
    const header = screen.getByLabelText(/current month, day \d+ of \d+/i);
    expect(header).toBeInTheDocument();
    // The day text is also on a hit-testable header title (not just the 1px marker).
    expect(header.getAttribute("title")).toMatch(/today, day \d+ of \d+/i);
  });

  it("does not add an elapsed marker on a non-current month", () => {
    render(<MonthColumnHeader month={other} availableMonths={[other]} />);
    expect(screen.getByLabelText(/^Month:/).getAttribute("aria-label")).not.toMatch(/day \d+ of/i);
  });

  it("does not mark a non-current month", () => {
    render(<MonthColumnHeader month={other} availableMonths={[other]} />);
    const header = screen.getByLabelText(/^Month:/);
    expect(header).not.toHaveAttribute("aria-current");
    expect(header.getAttribute("aria-label")).not.toMatch(/current month/i);
  });
});
