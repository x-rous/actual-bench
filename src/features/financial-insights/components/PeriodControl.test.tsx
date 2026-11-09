import { render, screen } from "@testing-library/react";
import { resolvePeriod } from "@/lib/financial-insights/period";
import { PeriodControl } from "./PeriodControl";

const period = resolvePeriod({ kind: "preset", id: "last-12" }, "2026-11-18", "2019-01");
const show = (hideDates?: boolean) => render(<PeriodControl choice={{ kind: "preset", id: "last-12" }} period={period} today="2026-11-18" firstMonth="2019-01" onChange={jest.fn()} hideDates={hideDates} />);

describe("the period control", () => {
  it("names the period and its dates", () => {
    show();
    const button = screen.getByRole("button", { name: /^Period: Last 12 months, / });
    expect(button).toHaveTextContent(/Nov 2025/);
  });

  it("names only the period when dates are hidden, in its text and its accessible name", () => {
    const { container } = show(true);
    expect(screen.getByRole("button", { name: "Period: Last 12 months. Change the period" })).toBeInTheDocument();
    expect(container.textContent).toBe("Last 12 months");
  });

  it("calls a custom range by that name when dates are hidden", () => {
    const custom = resolvePeriod({ kind: "custom", startMonth: "2026-01", endMonth: "2026-03" }, "2026-11-18", "2019-01");
    render(<PeriodControl choice={{ kind: "custom", startMonth: "2026-01", endMonth: "2026-03" }} period={custom} today="2026-11-18" firstMonth="2019-01" onChange={jest.fn()} hideDates />);
    expect(screen.getByRole("button", { name: "Period: Custom range. Change the period" })).toBeInTheDocument();
  });
});
