import { pickLabels } from "./ShapeChart";

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
