import { render } from "@testing-library/react";
import { asShape } from "@/lib/financial-insights/progress";
import { THEME_PALETTE } from "../../lib/progressPalette";
import { StripChart, stripLayout } from "./ProgressShapes";
import { ShapeGauge, pickLabels } from "./ShapeChart";

const xs = (n: number, width = 692) => Array.from({ length: n }, (_, i) => 36 + (width * i) / Math.max(1, n - 1));

describe("month labels on a chart", () => {
  it("are spaced evenly, with the same gap between every pair", () => {
    for (const n of [2, 5, 12, 13, 24, 37, 60, 95]) {
      const picked = pickLabels(xs(n), 70);
      const gaps = picked.slice(1).map((v, i) => v - picked[i]);
      expect(new Set(gaps).size).toBeLessThanOrEqual(1);
      expect(picked[0]).toBe(0);
    }
  });

  it("do not touch, and end on the last month when an even step allows it", () => {
    const picked = pickLabels(xs(13), 70);
    expect(picked.at(-1)).toBe(12);
    const spaced = pickLabels(xs(95), 70).map((i) => xs(95)[i]);
    for (let i = 1; i < spaced.length; i++) expect(spaced[i] - spaced[i - 1]).toBeGreaterThanOrEqual(70);
  });

  it("labels the only month of a one-month period", () => {
    expect(pickLabels(xs(1), 70)).toEqual([0]);
  });
});

describe("the cash buffer gauge", () => {
  const widths = (fill: number, reach: number | null) => {
    const { container } = render(<ShapeGauge fill={asShape(fill)} reachFill={reach === null ? null : asShape(reach)} marks={[]} palette={THEME_PALETTE} ariaLabel="gauge" endLabels={{ start: "0", end: "12 months" }} />);
    return [...container.querySelectorAll("rect")].map((r) => Number(r.getAttribute("width")));
  };

  it("draws each fill exactly as wide as its share of the bar, however short", () => {
    // 0.1 and 0.2 months of 12, as shapes (3 decimals): about 0.8% and 1.7% of a 692-wide bar, not a minimum width.
    const [track, reach, fill] = widths(0.1 / 12, 0.2 / 12);
    expect(fill).toBeCloseTo(asShape(0.1 / 12) * track, 5);
    expect(reach).toBeCloseTo(asShape(0.2 / 12) * track, 5);
    expect(fill).toBeLessThan(10);
    expect(reach).toBeLessThan(20);
  });

  it("keeps a fill's corners inside its width", () => {
    const { container } = render(<ShapeGauge fill={asShape(0.1 / 12)} reachFill={null} marks={[]} palette={THEME_PALETTE} ariaLabel="gauge" endLabels={{ start: "0", end: "12 months" }} />);
    const fill = [...container.querySelectorAll("rect")][1];
    expect(Number(fill.getAttribute("rx"))).toBeLessThanOrEqual(Number(fill.getAttribute("width")) / 2);
  });
});

describe("the savings consistency squares", () => {
  it("are one row of up to 56 px squares for 12 months or fewer", () => {
    for (const n of [2, 6, 12]) {
      const layout = stripLayout(n, 692, 56);
      expect(layout.rows).toBe(1);
      expect(layout.columns).toBe(n);
      expect(layout.size).toBeLessThanOrEqual(56);
    }
  });

  it("wrap a long history onto several lines of smaller squares that fit the chart", () => {
    for (const n of [13, 24, 60, 95, 120]) {
      const { columns, size, gap, rows } = stripLayout(n, 618, 226);
      expect(columns * rows).toBeGreaterThanOrEqual(n);
      expect(rows).toBeGreaterThan(1);
      expect(rows * size + (rows - 1) * gap).toBeLessThanOrEqual(226);
      expect(columns * size + (columns - 1) * gap).toBeLessThanOrEqual(618 + 0.001);
    }
    // More months: smaller squares.
    expect(stripLayout(120, 618, 226).size).toBeLessThan(stripLayout(24, 618, 226).size);
  });

  it("draws a square and a mark for each month, and names the month each line starts at", () => {
    const strip = Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? "short" : i % 7 === 0 ? "none" : "saved")) as ("saved" | "short" | "none")[];
    const labels = strip.map((_, i) => `Month ${i + 1}`);
    const { container } = render(<StripChart strip={strip} xLabels={labels} palette={THEME_PALETTE} ariaLabel="strip" />);
    const marks = container.querySelectorAll("path").length;
    expect(marks).toBe(strip.filter((s) => s !== "none").length);
    expect(container.querySelectorAll("rect")).toHaveLength(30);
    const { columns } = stripLayout(30, 618, 226);
    const names = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(names).toEqual(Array.from({ length: Math.ceil(30 / columns) }, (_, r) => `Month ${r * columns + 1}`));
  });
});
