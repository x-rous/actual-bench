// eslint-disable-next-line @typescript-eslint/no-require-imports
const scenario = require("./seed-scenario.cjs") as {
  BASE_BUDGETS: Record<string, number>;
  CATEGORY_GROUPS: Array<{
    categories: Array<[string, string]>;
  }>;
  DEMO_BUDGETS: Array<{ name: string; mode: string; stableGroupId: string }>;
  TAGS: Array<[string, string, string]>;
  buildMonths(now: Date): Array<{
    key: string;
    monthNumber: number;
    isCurrent: boolean;
  }>;
  budgetPlanForMonth(month: { monthNumber: number }): Record<string, number>;
  scenarioForMonth(
    month: { monthNumber: number; isCurrent: boolean },
    index: number
  ): { label: string };
};

describe("demo seed scenario", () => {
  it("defines the two requested budget names and modes", () => {
    expect(scenario.DEMO_BUDGETS).toEqual([
      expect.objectContaining({ name: "Live Demo - Envelope", mode: "envelope" }),
      expect.objectContaining({ name: "Live Demo - Tracking", mode: "tracking" }),
    ]);
    expect(new Set(scenario.DEMO_BUDGETS.map((budget) => budget.stableGroupId)).size).toBe(2);
  });

  it("builds twelve completed months plus the current partial month", () => {
    const months = scenario.buildMonths(new Date(2026, 7, 14));

    expect(months).toHaveLength(13);
    expect(months[0].key).toBe("2025-08");
    expect(months.at(-1)).toMatchObject({ key: "2026-08", isCurrent: true });
  });

  it("provides a broad household category and tag catalog", () => {
    const categoryCount = scenario.CATEGORY_GROUPS.reduce(
      (total, group) => total + group.categories.length,
      0
    );

    expect(scenario.CATEGORY_GROUPS).toHaveLength(10);
    expect(categoryCount).toBeGreaterThanOrEqual(40);
    expect(Object.keys(scenario.BASE_BUDGETS)).toHaveLength(categoryCount - 5);
    expect(scenario.TAGS).toHaveLength(10);
    expect(scenario.TAGS.every(([, color, description]) => color && description)).toBe(true);
  });

  it("varies plans seasonally and includes good and difficult months", () => {
    const winter = scenario.budgetPlanForMonth({ monthNumber: 1 });
    const summer = scenario.budgetPlanForMonth({ monthNumber: 7 });
    expect(winter.naturalGas).toBeGreaterThan(summer.naturalGas);
    expect(summer.electric).toBeGreaterThan(winter.electric);

    const months = scenario.buildMonths(new Date(2026, 7, 14));
    const labels = months.map((month, index) =>
      scenario.scenarioForMonth(month, index).label
    );
    expect(labels).toContain("good");
    expect(labels.some((label) => label.startsWith("bad-"))).toBe(true);
    expect(labels).toContain("current-partial");
  });
});
