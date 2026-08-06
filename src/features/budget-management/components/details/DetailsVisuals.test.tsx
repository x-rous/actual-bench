import { render, screen } from "@testing-library/react";
import { CoverageStrip, DayProgressBar, StatusChip, TrajectorySection } from "./DetailsVisuals";
import type {
  DetailsCoverage,
  TrajectoryMetrics,
} from "../../lib/budgetDetailsMetrics";

const coverage: DetailsCoverage = {
  segments: ["past", "past", "current-partial", "future"],
  closedCount: 2,
  currentCount: 1,
  futureCount: 1,
  totalMonths: 4,
};

describe("CoverageStrip", () => {
  it("renders one segment per month with a descriptive label", () => {
    render(<CoverageStrip coverage={coverage} />);
    const strip = screen.getByRole("img");
    expect(strip).toHaveAttribute(
      "aria-label",
      "2 of 4 closed · 1 in progress · 1 planned",
    );
    expect(strip.children).toHaveLength(4);
  });
});

describe("DayProgressBar", () => {
  it("labels the elapsed day for an in-progress month", () => {
    render(
      <DayProgressBar
        progress={{ elapsedFraction: 0.45, dayLabel: "day 14 of 31", closed: false }}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "day 14 of 31");
  });
});

describe("StatusChip", () => {
  it("shows the label with a default glyph for the tone", () => {
    render(<StatusChip label="on track" tone="positive" />);
    expect(screen.getByText("on track")).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
  });
});

describe("TrajectorySection", () => {
  const trajectory: TrajectoryMetrics = {
    label: "Projected result",
    projectedValue: 463_000,
    planLabel: "Full-period plan",
    planValue: 470_000,
    variance: -7_000,
    varianceLabel: "below",
    tone: "positive",
    lineTone: "positive",
    chipLabel: "on track",
    chipTone: "positive",
    isSpend: false,
    todayIndex: 1,
    points: [
      { month: "2026-07", plan: 200_000, actual: 240_000 },
      { month: "2026-08", plan: 270_000, actual: 263_000 },
      { month: "2026-09", plan: 470_000, actual: null },
    ],
    breakdown: { openPlan: 223_000, openMonthCount: 2 },
  };

  it("leads with the projected headline, the verdict chip and the plan comparison", () => {
    render(<TrajectorySection trajectory={trajectory} />);
    expect(screen.getByText("Projected result")).toBeInTheDocument();
    expect(screen.getByText("on track")).toBeInTheDocument();
    // Whole dollars on the chart: 463_000 minor → +4,630 (no cents).
    expect(screen.getByText("+4,630")).toBeInTheDocument();
    expect(screen.getByText("Full-period plan")).toBeInTheDocument();
    expect(screen.getByText("70 below")).toBeInTheDocument();
    expect(screen.getByText("vs plan")).toBeInTheDocument();
    // Upcoming-plan line shows only the open-months contribution (no "Closed so far").
    expect(screen.getByText("Upcoming plan · 2 mo")).toBeInTheDocument();
    expect(screen.queryByText("Closed so far")).not.toBeInTheDocument();
    // The sparkline is present and labelled, with the renamed legend + Now marker.
    expect(
      screen.getByLabelText(/Cumulative actual to date/),
    ).toBeInTheDocument();
    expect(screen.getByText("Projection")).toBeInTheDocument();
    expect(screen.queryByText("Forecast")).not.toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
  });
});
