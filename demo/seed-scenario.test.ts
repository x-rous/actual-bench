// eslint-disable-next-line @typescript-eslint/no-require-imports
const scenario = require("./seed-scenario.cjs") as {
  BASE_BUDGETS: Record<string, number>;
  CATEGORY_GROUPS: Array<{
    income?: boolean;
    categories: Array<[string, string]>;
  }>;
  DEMO_BUDGETS: Array<{ name: string; mode: string; stableGroupId: string }>;
  TAGS: Array<[string, string, string]>;
  MARKET_RETURNS: number[];
  buildMonths(now: Date): Array<{
    key: string;
    monthNumber: number;
    index: number;
    phase: "before" | "after";
    isCurrent: boolean;
  }>;
  budgetPlanForMonth(month: { monthNumber: number; index?: number; phase?: string }): Record<string, number>;
  scenarioForMonth(
    month: { monthNumber: number; isCurrent: boolean },
    index: number
  ): { label: string; incomeAdjustment: number; bonusAmount: number; event: string | null; restaurantFactor: number };
};

describe("demo seed scenario", () => {
  it("defines the two requested budget names and modes", () => {
    expect(scenario.DEMO_BUDGETS).toEqual([
      expect.objectContaining({ name: "Live Demo - Envelope", mode: "envelope" }),
      expect.objectContaining({ name: "Live Demo - Tracking", mode: "tracking" }),
    ]);
    expect(new Set(scenario.DEMO_BUDGETS.map((budget) => budget.stableGroupId)).size).toBe(2);
  });

  it("builds two completed years plus the current partial month", () => {
    const months = scenario.buildMonths(new Date(2026, 7, 14));

    expect(months).toHaveLength(25);
    expect(months[0]).toMatchObject({ key: "2024-08", index: 0, phase: "before" });
    expect(months[12]).toMatchObject({ key: "2025-08", phase: "after" });
    expect(months.at(-1)).toMatchObject({ key: "2026-08", isCurrent: true, phase: "after" });
    expect(scenario.MARKET_RETURNS).toHaveLength(months.length);
  });

  it("tells a before-and-after story across the two years", () => {
    const months = scenario.buildMonths(new Date(2026, 7, 14));
    const before = scenario.budgetPlanForMonth(months[2]);
    const after = scenario.budgetPlanForMonth(months[14]);
    expect(after.investing).toBeGreaterThan(before.investing);
    expect(before.legacyCable).toBeGreaterThan(0);
    expect(after.legacyCable).toBe(0);
    expect(scenario.scenarioForMonth(months[14], 14).restaurantFactor).toBeLessThan(
      scenario.scenarioForMonth(months[2], 2).restaurantFactor
    );
  });

  it("provides a broad household category and tag catalog", () => {
    const categoryCount = scenario.CATEGORY_GROUPS.reduce(
      (total, group) => total + group.categories.length,
      0
    );
    const expenseCategoryKeys = scenario.CATEGORY_GROUPS.filter(
      (group) => !group.income
    ).flatMap((group) => group.categories.map(([key]) => key));

    expect(scenario.CATEGORY_GROUPS).toHaveLength(10);
    expect(categoryCount).toBeGreaterThanOrEqual(40);
    expect(Object.keys(scenario.BASE_BUDGETS).sort()).toEqual(
      [...expenseCategoryKeys].sort()
    );
    expect(scenario.TAGS.length).toBeGreaterThanOrEqual(13);
    expect(scenario.TAGS.map(([tag]) => tag)).toEqual(expect.arrayContaining(["family-holiday", "rental-property", "loan-interest"]));
    expect(scenario.TAGS.every(([, color, description]) => color && description)).toBe(true);
  });

  it("varies plans seasonally and includes good and difficult months", () => {
    const winter = scenario.budgetPlanForMonth({ monthNumber: 1 });
    const summer = scenario.budgetPlanForMonth({ monthNumber: 7 });
    expect(winter.naturalGas).toBeGreaterThan(summer.naturalGas);
    expect(summer.electric).toBeGreaterThan(winter.electric);
    expect(summer.vacationFund).toBe(0);

    const months = scenario.buildMonths(new Date(2026, 7, 14));
    const labels = months.map((month, index) =>
      scenario.scenarioForMonth(month, index).label
    );
    expect(labels).toContain("good");
    expect(labels.some((label) => label.startsWith("bad-"))).toBe(true);
    expect(labels).toContain("current-partial");

    const bonus = scenario.scenarioForMonth(months[10], 10);
    expect(bonus).toMatchObject({ event: "bonus", incomeAdjustment: 0 });
    expect(scenario.scenarioForMonth(months[22], 22).bonusAmount).toBeGreaterThan(bonus.bonusAmount);

    // Generated in February 2027, the second bonus lands in December: the
    // holiday event replaces "bonus", and the amount is what posts it.
    const generatedInFebruary = scenario.buildMonths(new Date(2027, 1, 14));
    const december = scenario.scenarioForMonth(generatedInFebruary[22], 22);
    expect(generatedInFebruary[22].monthNumber).toBe(12);
    expect(december).toMatchObject({ event: "holiday" });
    expect(december.bonusAmount).toBeGreaterThan(0);
  });
});
