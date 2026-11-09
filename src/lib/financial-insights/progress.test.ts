import { cashBuffer, savingsRateOf, type AccountFact, type LoanScheduleInput, type MovementRow } from "./measures";
import { changeBetween, progressView, safeReason, toShape, type DebtCard, type MilestonesCard, type ProgressInput, type ProgressView, type SavingsCard } from "./progress";
import type { ScheduleInput } from "./debt";
import { AMOUNTS_MINOR, AMOUNTS_TEXT, NAMES, car, chk, factsOf, home, inputOf, ltvTen, mortgage, months, pay, richFacts, row, today, visa } from "./testing/progressFixture";

const card = <T extends ProgressView["cards"][number]["kind"]>(view: ProgressView, kind: T) => view.cards.find((c) => c.kind === kind) as Extract<ProgressView["cards"][number], { kind: T }> | undefined;

describe("toShape", () => {
  it("scales by the largest absolute value, keeps the sign and rounds to three decimals", () => {
    const shape = toShape([-300, 100, 200, 0])!;
    expect(shape.points).toEqual([-1, 0.333, 0.667, 0]);
    expect(shape.zero).toBe(0);
  });

  it("keeps a one-sided series on one side of zero, so the chart runs from zero to the extreme", () => {
    const up = toShape([10, 20, 40])!;
    expect(up.points.every((p) => p! > 0)).toBe(true);
    expect(Math.max(...up.points.map((p) => p!))).toBe(1);
    const down = toShape([-10, -20, -40])!;
    expect(down.points.every((p) => p! < 0)).toBe(true);
    expect(Math.min(...down.points.map((p) => p!))).toBe(-1);
  });

  it("keeps a missing month as null, never zero, and returns no shape for nothing but zeros and gaps", () => {
    expect(toShape([null, 5, null, 10])!.points).toEqual([null, 0.5, null, 1]);
    expect(toShape([0, 0, 0])).toBeNull();
    expect(toShape([null, null])).toBeNull();
    expect(toShape([])).toBeNull();
  });
});

describe("the percentage guards", () => {
  it("writes an ordinary change as a percent and says improved or worsened when both ends are below zero", () => {
    expect(changeBetween(100, 134.2)).toEqual({ kind: "up", percent: 34.2 });
    expect(changeBetween(100, 91.9)).toEqual({ kind: "down", percent: 8.1 });
    expect(changeBetween(-100, -78)).toEqual({ kind: "improved", percent: 22 });
    expect(changeBetween(-100, -130)).toEqual({ kind: "worsened", percent: 30 });
  });

  it("does not give a percentage for a change of more than 10× either way, from zero, or across zero", () => {
    expect(changeBetween(10, 500)).toEqual({ kind: "tenfold", direction: "up" });
    expect(changeBetween(1000, 50)).toEqual({ kind: "tenfold", direction: "down" });
    expect(changeBetween(0, 50)).toBeNull();
    expect(changeBetween(-20, 30)).toBeNull();
  });

  it("names the month the net worth crossed zero instead of a percentage, and the month it fell below", () => {
    const up = factsOf([chk], [...months(1, 10).map((m) => row(m, "chk", 100_000))], [{ accountId: "chk", amountMinor: -350_000 }]);
    const view = progressView(inputOf(up));
    const worth = card(view, "netWorth")!;
    expect(worth.labels[0]).toEqual({ on: "Crossed zero in Apr 2026", off: "Crossed zero after 3 months" });
    const down = factsOf([chk], [...months(1, 10).map((m) => row(m, "chk", -100_000))], [{ accountId: "chk", amountMinor: 350_000 }]);
    expect(card(progressView(inputOf(down)), "netWorth")!.labels[0].on).toBe("Fell below zero in Apr 2026");
  });

  it("says net worth improved, not up, when both ends are below zero", () => {
    const f = factsOf([chk], months(1, 10).map((m) => row(m, "chk", 10_000)), [{ accountId: "chk", amountMinor: -1_000_000 }]);
    expect(card(progressView(inputOf(f)), "netWorth")!.labels[0].on).toMatch(/^Net worth improved by \d+\.\d%$/);
  });

  it("draws a savings rate below -100% at -100% and says so", () => {
    const f = factsOf([chk], months(1, 10).flatMap((m) => [row(m, "chk", 1_000, { categoryId: "salary" }), row(m, "chk", -5_000, { categoryId: "food" })]));
    const savings = card(progressView(inputOf(f)), "savings")!;
    expect(Math.min(...savings.bars.filter((b) => b !== null) as number[])).toBe(-1);
    expect(savings.labels[0].on).toBe("Savings rate below −100% over the period");
  });

  it("replaces a reason that could carry a name, and keeps the plain ones", () => {
    expect(safeReason(`${NAMES[3]}: its schedule does not agree`, "generic")).toBe("generic");
    expect(safeReason("Cash & bank is below zero", "generic")).toBe("Cash & bank is below zero");
  });
});

describe("what the view may hold", () => {
  const SHAPE_KEYS = new Set(["points", "bars", "zero", "fill", "accessibleFill", "at"]);
  const NUMBER_KEYS = new Set([...SHAPE_KEYS, "peak"]);

  function walk(value: unknown, key: string, inShape: boolean, seen: string[]): void {
    if (typeof value === "number") {
      expect(Number.isFinite(value)).toBe(true);
      expect(NUMBER_KEYS.has(key) || inShape).toBe(true);
      if (inShape) { expect(value).toBeGreaterThanOrEqual(-1); expect(value).toBeLessThanOrEqual(1); }
      return;
    }
    if (Array.isArray(value)) { value.forEach((v) => walk(v, key, inShape, seen)); return; }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        seen.push(k);
        expect(k).not.toMatch(/Minor$/);
        expect(["amount", "balance", "value", "total"]).not.toContain(k);
        walk(v, k, SHAPE_KEYS.has(k), seen);
      }
    }
  }

  function everything(): ProgressView {
    const facts = richFacts();
    const schedules: ScheduleInput[] = [
      { accountId: "mortgage", state: "ready", principalNext12Minor: 1, costNext12Minor: 1, payoffDate: "2036-03-01" },
      { accountId: "car", state: "unavailable", reason: `${NAMES[3]} does not reconcile` },
    ];
    return progressView(inputOf(facts, { schedules, equity: [home("a", ltvTen), home("b", ltvTen.map((v) => v + 5), "vehicle")] }));
  }

  it("holds only Shape, Percent, Months and Count numbers, with no field named for an amount, and every Shape between -1 and 1", () => {
    const view = everything();
    expect(view.cards.map((c) => c.kind)).toEqual(["netWorth", "debt", "savings", "buffer", "equity", "equity", "milestones"]);
    walk(view, "", false, []);
  });

  it("contains no fixture amount, in minor or major units, and no account, loan or asset name", () => {
    const text = JSON.stringify(everything());
    for (const minor of AMOUNTS_MINOR) expect(text).not.toContain(String(minor));
    for (const amount of AMOUNTS_TEXT) expect(text).not.toContain(amount);
    for (const name of NAMES) expect(text).not.toContain(name);
    expect(text).not.toMatch(/[$€£¥]|USD|EUR|GBP/);
  });

  it("never lets a buffer reason carry a loan's name", () => {
    // A tracked loan whose schedule does not reconcile: the buffer names the loan in its reason.
    const f = factsOf([chk, car], months(1, 10).flatMap((m) => [row(m, "chk", 4_000_000, { categoryId: "salary" }), row(m, "chk", -3_000_000, { categoryId: "food" })]), [{ accountId: "chk", amountMinor: 9_000_000 }, { accountId: "car", amountMinor: -2_000_000 }]);
    const base = inputOf(f);
    const input = { ...base, buffer: cashBuffer(base.ledger, today, new Map<string, LoanScheduleInput>([["car", { state: "unavailable", reason: "Its schedule does not agree with the loan account" }]]), {}) };
    expect(input.buffer.state).toBe("unavailable");
    expect(input.buffer.state === "unavailable" && input.buffer.reason).toContain(NAMES[3]);
    const buffer = card(progressView(input), "buffer")!;
    expect(buffer.state).toBe("unavailable");
    expect(JSON.stringify(buffer)).not.toContain(NAMES[3]);
  });

  it("gives every dated line a form without the months named", () => {
    const view = everything();
    const lines = view.cards.flatMap((c) => ("labels" in c ? c.labels : c.kind === "milestones" ? c.items : []));
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(line.off).not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|20\d\d/);
  });
});

describe("savings rate", () => {
  it("equals Summary's rate for the same period, and each month goes through the same definition", () => {
    const input = inputOf(richFacts());
    const savings = card(progressView(input), "savings")!;
    expect(input.summary.savingsRate.state).toBe("ready");
    const value = (input.summary.savingsRate as { value: number }).value;
    expect(savings.labels[0].on).toBe(`Savings rate ${value.toFixed(1)}% over the period`);
    // March spent more than it received: -12.5%, drawn below the line. The other months kept 25%.
    const monthRate = savingsRateOf({ state: "ready", value: 1_000_000 }, 4_000_000);
    expect(monthRate).toEqual({ state: "ready", value: 25 });
    expect(savings.bars[2]).toBe(-0.125);
    expect(savings.bars[0]).toBe(0.25);
    expect(savings.labels.map((l) => l.on)).toContain("Best month: Jan 2026, 25.0%");
    expect(savings.labels.map((l) => l.on)).toContain("Saved in 9 of 10 months · 7 months in a row");
  });

  it("leaves a month with no income as a gap with a note, and the card out when no month had income", () => {
    const movement = [row("2026-01", "chk", 4_000_000, { categoryId: "salary" }), row("2026-01", "chk", -1_000_000, { categoryId: "food" }), row("2026-02", "chk", -200_000, { categoryId: "food" })];
    const savings = card(progressView(inputOf(factsOf([chk], movement), {}, ["2026-01", "2026-02"])), "savings")!;
    expect(savings.bars).toEqual([0.75, null]);
    expect(savings.gapNote).toBe("Months with no income are left blank");
    const none = progressView(inputOf(factsOf([chk], [row("2026-01", "chk", -100, { categoryId: "food" })]), {}, ["2026-01", "2026-02"]));
    expect(card(none, "savings")).toBeUndefined();
  });

  it("shows the reason Summary gives when the rate is unavailable, never zero", () => {
    const input = inputOf(richFacts());
    const view = progressView({ ...input, summary: { ...input.summary, savingsRate: { state: "unavailable", reason: "There was no income in this period" } } });
    expect(card(view, "savings")!.labels[0].on).toBe("There was no income in this period");
  });

  it("leaves the partial current month out of the labels", () => {
    const f = factsOf([chk], [...months(1, 11).map((m) => row(m, "chk", 4_000_000, { categoryId: "salary" })), row("2026-11", "chk", -3_900_000, { categoryId: "food" }), ...months(1, 10).map((m) => row(m, "chk", -3_000_000, { categoryId: "food" }))]);
    const savings = card(progressView(inputOf(f, {}, ["2026-01", "2026-11"])), "savings") as SavingsCard;
    expect(savings.axis.partial.at(-1)).toBe(true);
    expect(savings.labels.map((l) => l.on).join()).toContain("Saved in 10 of 10 months");
  });
});

describe("cash buffer", () => {
  function bufferFacts() {
    // No loans, so the buffer can be worked out.
    const movement = months(1, 10).flatMap((m) => [row(m, "chk", 4_000_000, { categoryId: "salary" }), row(m, "chk", -3_000_000, { categoryId: "food" })]);
    return factsOf([chk], movement, [{ accountId: "chk", amountMinor: 9_000_000 }]);
  }

  it("shows the buffer's own months, and the accessible figure when it exists", () => {
    const input = inputOf(bufferFacts());
    expect(input.buffer.state).toBe("ready");
    const months12 = (input.buffer as { value: { months: number } }).value.months;
    const buffer = card(progressView(input), "buffer")!;
    if (buffer.state !== "ready") throw new Error("expected a ready buffer");
    expect(buffer.labels[0].on).toBe(`${(Math.round(months12 * 10) / 10).toFixed(1)} months of spending covered`);
    expect(buffer.accessibleFill).toBeNull();
    expect(buffer.marks).toEqual([{ at: 0.25, label: "3 months" }, { at: 0.5, label: "6 months" }]);
    const withReach = progressView({ ...input, buffer: { state: "ready", value: { ...(input.buffer as { value: object }).value, months: 4.24, monthsWithAccessible: 6.81 } as never } });
    const b = card(withReach, "buffer")!;
    if (b.state !== "ready") throw new Error("expected a ready buffer");
    expect(b.labels.map((l) => l.on)).toEqual(["4.2 months of spending covered", "6.8 months counting investments you can reach"]);
    expect(b.accessibleFill).toBe(0.567);
  });

  it("fills the bar and says 12+ months over a year, and never shows zero for an unavailable buffer", () => {
    const input = inputOf(bufferFacts());
    const over = progressView({ ...input, buffer: { state: "ready", value: { ...(input.buffer as { value: object }).value, months: 15.3 } as never } });
    const b = card(over, "buffer")!;
    if (b.state !== "ready") throw new Error("expected a ready buffer");
    expect(b.fill).toBe(1);
    expect(b.labels[0].on).toBe("12+ months of spending covered");
    const none = card(progressView({ ...input, buffer: { state: "unavailable", reason: "There is no regular spending to measure against" } }), "buffer")!;
    expect(none).toMatchObject({ state: "unavailable", reason: "There is no regular spending to measure against" });
    expect(JSON.stringify(none)).not.toContain("0 months");
  });
});

describe("debt payoff", () => {
  const schedule = (accountId: string, payoffDate: string | null): ScheduleInput => ({ accountId, state: "ready", principalNext12Minor: 1, costNext12Minor: 1, payoffDate });
  const debt = (input: ProgressInput) => card(progressView(input), "debt") as DebtCard;
  const choice = (c: DebtCard, id: string) => c.choices.find((x) => x.id === id)!;

  it("offers credit cards, loans and all debt, defaults to credit cards, and finds the peak, the streak and the month it was paid off", () => {
    const c = debt(inputOf(richFacts()));
    expect(c.choices.map((x) => x.id)).toEqual(["cards", "loans", "all"]);
    expect(c.defaultChoice).toBe("cards");
    const cards = choice(c, "cards");
    expect(cards.peak).toBe(0);
    // The card is paid off in June, and stays paid (in credit counts as nothing owed).
    expect(cards.labels.map((l) => l.on)).toContain("Paid off in Jun 2026");
    expect(cards.labels.find((l) => l.on.startsWith("Paid off"))!.off).toBe("Paid off after 5 months");
    const loans = choice(c, "loans");
    expect(loans.labels[0].on).toMatch(/^\d+\.\d% paid off since the peak in Jan 2026$/);
    expect(loans.labels.map((l) => l.on)).toContain("Lower 9 months in a row");
    expect(loans.chart.points[0]).toBe(1);
  });

  it("defaults to loans when there are no credit cards, and hides the card when nothing was owed", () => {
    const f = factsOf([chk, mortgage], months(1, 10).flatMap((m) => [row(m, "chk", 100_000), ...pay(m, "chk", "mortgage", 500_000)]), [{ accountId: "mortgage", amountMinor: -12_000_000 }]);
    const c = debt(inputOf(f));
    expect(c.choices.map((x) => x.id)).toEqual(["loans"]);
    expect(c.defaultChoice).toBe("loans");
    expect(card(progressView(inputOf(factsOf([chk], months(1, 10).map((m) => row(m, "chk", 1_000))))), "debt")).toBeUndefined();
  });

  it("says 'at its highest' when the latest month is the peak", () => {
    const f = factsOf([chk, visa], [...months(1, 10).map((m) => row(m, "chk", 1_000)), ...months(1, 10).map((m, i) => row(m, "visa", -100_000 * (i + 1), { categoryId: "food" }))]);
    expect(choice(debt(inputOf(f)), "cards").labels[0].on).toBe("At its highest in this period");
  });

  it("shows the debt-free date for loans only when every loan still owed has a payoff date from Loans", () => {
    const owedLoans = factsOf([chk, mortgage, car], months(1, 10).flatMap((m) => pay(m, "chk", "mortgage", 100_000)), [{ accountId: "mortgage", amountMinor: -5_000_000 }, { accountId: "car", amountMinor: -2_000_000 }]);
    const without = (schedules: ScheduleInput[]) => choice(debt(inputOf(owedLoans, { schedules })), "loans").labels.map((l) => l.on);
    expect(without([schedule("mortgage", "2028-01-15"), schedule("car", "2027-06-01")])).toContain("Debt-free in about 14 months (Jan 2028)");
    expect(choice(debt(inputOf(owedLoans, { schedules: [schedule("mortgage", "2028-01-15"), schedule("car", "2027-06-01")] })), "loans").labels.at(-1)!.off).toBe("Debt-free in about 14 months");
    // One loan with no payoff date, one not tracked at all, a past date: no label, never a guess.
    expect(without([schedule("mortgage", "2028-01-15"), schedule("car", null)]).join()).not.toContain("Debt-free");
    expect(without([schedule("mortgage", "2028-01-15")]).join()).not.toContain("Debt-free");
    expect(without([schedule("mortgage", "2028-01-15"), { accountId: "car", state: "unavailable", reason: "x" }]).join()).not.toContain("Debt-free");
    expect(without([schedule("mortgage", "2026-01-15"), schedule("car", "2027-06-01")]).join()).not.toContain("Debt-free");
    // Credit cards are never projected.
    expect(choice(debt(inputOf(richFacts(), { schedules: [schedule("mortgage", "2036-03-01")] })), "cards").labels.join()).not.toContain("Debt-free");
  });
});

describe("home equity", () => {
  it("makes one card per linked asset, titled by class only, with the same loan-to-value the equity points hold", () => {
    const view = progressView(inputOf(richFacts(), { equity: [home("a", ltvTen), home("b", ltvTen), home("c", ltvTen, "vehicle"), home("d", ltvTen, "other-asset")] }));
    const cards = view.cards.filter((c) => c.kind === "equity");
    expect(cards.map((c) => c.title)).toEqual(["Home 1", "Home 2", "Vehicle", "Asset"]);
    const first = cards[0] as Extract<typeof cards[number], { kind: "equity" }>;
    expect(first.chart.points.at(-1)).toBe(0.614);
    expect(first.reference).toEqual({ at: 0.8, label: "80%" });
    expect(first.labels.map((l) => l.on)).toEqual(["You own 38.6%", "LTV down from 72.0% to 61.4%"]);
  });

  it("names the month it went below 80% for good, draws months with gaps as gaps, and is absent without linked assets or any LTV", () => {
    const view = progressView(inputOf(richFacts(), { equity: [home("a", [85, 84, null, 79, 78, 77, 76, 75, 74, 73])] }));
    const c = card(view, "equity")!;
    expect(c.labels.map((l) => l.on)).toContain("Below 80% since Apr 2026");
    expect(c.chart.points[2]).toBeNull();
    expect(card(progressView(inputOf(richFacts(), { equity: [home("a", Array(10).fill(null))] })), "equity")).toBeUndefined();
    expect(card(progressView(inputOf(richFacts(), { equity: [] })), "equity")).toBeUndefined();
    expect(progressView(inputOf(richFacts(), { equity: null })).equityPending).toBe(true);
  });
});

describe("milestones", () => {
  const milestones = (input: ProgressInput) => card(progressView(input), "milestones") as MilestonesCard;
  const items = (input: ProgressInput) => milestones(input).items.map((i) => i.on);
  const readyBuffer = (months: number): ProgressInput["buffer"] => ({ state: "ready", value: { months } as never });
  const idle = (extra: MovementRow[] = []) => months(1, 10).flatMap((m) => [row(m, "chk", 1_000_000, { categoryId: "salary" }), row(m, "chk", -1_000_000, { categoryId: "food" })]).concat(extra);

  it("lists net worth above zero and a streak of saved months", () => {
    const f = factsOf([chk], months(1, 10).flatMap((m) => [row(m, "chk", 4_500_000, { categoryId: "salary" }), row(m, "chk", -3_000_000, { categoryId: "food" })]), [{ accountId: "chk", amountMinor: -10_000_000 }]);
    const list = items(inputOf(f, { buffer: { state: "unavailable", reason: "x" } }));
    // Net worth was -85,000.00 at the end of January and rose 15,000.00 a month: above zero in July.
    expect(list).toEqual(["Net worth above zero: Jul 2026", "Saved 6 months in a row: Jun 2026"]);
    expect(milestones(inputOf(f)).items[0].off).toMatch(/^(Now|Net worth above zero: Month 7)/);
  });

  it("lists the credit cards paid off, a loan paid off, and 25%, 50% and 75% of loans paid off since the peak", () => {
    const f = factsOf([chk, visa, mortgage], [...idle(), ...months(1, 10).flatMap((m) => pay(m, "chk", "mortgage", 1_000_000)), ...months(2, 6).flatMap((m) => pay(m, "chk", "visa", 1_000_000))], [{ accountId: "chk", amountMinor: 100_000_000 }, { accountId: "visa", amountMinor: -4_000_000 }, { accountId: "mortgage", amountMinor: -9_000_000 }]);
    const list = items(inputOf(f, { buffer: { state: "unavailable", reason: "x" } }));
    expect(list).toEqual([
      "A loan paid off: Sep 2026", "75% of loans paid off since the peak: Jul 2026", "Credit cards paid off: May 2026", "50% of loans paid off since the peak: May 2026", "25% of loans paid off since the peak: Mar 2026",
    ]);
  });

  it("lists a home's loan-to-value passing below 80% and 50%, only when it was above the mark earlier in the period", () => {
    const list = items(inputOf(factsOf([chk], idle()), { buffer: { state: "unavailable", reason: "x" }, equity: [home("a", [85, 84, 83, 82, 81, 79, 60, 59, 58, 49]), home("b", [40, 39, 38, 37, 36, 35, 34, 33, 32, 31])] }));
    expect(list).toEqual(["Home 1 LTV below 50%: Oct 2026", "Home 1 LTV below 80%: Jun 2026"]);
  });

  it("puts what is true now first and undated, only the highest of 3+ and 6+ months of cash buffer", () => {
    const f = factsOf([chk], idle());
    expect(items(inputOf(f, { buffer: readyBuffer(7.2) }))).toEqual(["Now: 6+ months of cash buffer"]);
    expect(items(inputOf(f, { buffer: readyBuffer(4.1) }))).toEqual(["Now: 3+ months of cash buffer"]);
    expect(items(inputOf(f, { buffer: readyBuffer(2.9) }))).toEqual([]);
    expect(milestones(inputOf(f, { buffer: readyBuffer(4.1) })).items[0]).toEqual({ on: "Now: 3+ months of cash buffer", off: "Now: 3+ months of cash buffer" });
  });

  it("names a loan paid off without naming the loan, and caps the list at 8, newest first", () => {
    const loans: AccountFact[] = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, name: `Secret loan ${i}`, accountClass: "loan", treatment: null, offBudget: true }));
    const f = factsOf([chk, ...loans], loans.flatMap((l, i) => pay(`2026-${String(i + 1).padStart(2, "0")}`, "chk", l.id, 100_000)).concat(idle()), loans.map((l) => ({ accountId: l.id, amountMinor: -100_000 })));
    const m = milestones(inputOf(f, { buffer: { state: "unavailable", reason: "x" } }));
    expect(m.items).toHaveLength(8);
    expect(m.items[0].on).toBe("A loan paid off: Oct 2026");
    expect(m.items[0].off).toBe("A loan paid off: Month 10");
    expect(JSON.stringify(m)).not.toContain("Secret loan");
  });

  it("is empty with its own words, and offers all-time history unless the page already shows it", () => {
    const f = factsOf([chk], idle());
    const m = milestones(inputOf(f, { buffer: { state: "unavailable", reason: "x" } }));
    expect(m.items).toEqual([]);
    expect(m.empty).toBe("No milestones in this period yet.");
    expect(m.canSeeAllTime).toBe(true);
    expect(milestones(inputOf(f, { allTime: true })).canSeeAllTime).toBe(false);
  });
});

describe("which cards appear", () => {
  it("hides the net worth card for a single month and keeps savings, buffer and milestones", () => {
    const view = progressView(inputOf(richFacts(), {}, ["2026-10", "2026-10"]));
    expect(view.cards.map((c) => c.kind)).toEqual(["savings", "buffer", "milestones"]);
    expect(card(view, "savings")!.bars).toHaveLength(1);
  });

  it("says there is nothing to show for a net worth that never moved from zero", () => {
    const f = factsOf([chk], months(1, 10).flatMap((m) => [row(m, "chk", 1_000), row(m, "chk", -1_000)]));
    const worth = card(progressView(inputOf(f)), "netWorth")!;
    expect(worth.chart).toBeNull();
    expect(worth.empty).toBe("Nothing to show in this period");
  });
});

describe("net worth wording past ten times", () => {
  const label = (start: number, end: number) => {
    const f = factsOf([chk], [row("2026-09", "chk", 0), row("2026-10", "chk", end - start)], [{ accountId: "chk", amountMinor: start }]);
    const worth = card(progressView(inputOf(f, {}, ["2026-09", "2026-10"])), "netWorth")!;
    return worth.labels[0]?.on;
  };

  it("says improved by more than 90%, not up 10×, when it shrank to under a tenth of a negative start", () => {
    expect(label(-1_000_000, -50_000)).toBe("Net worth improved by more than 90%");
  });

  it("says worsened by more than 10× when a negative start grew more than tenfold", () => {
    expect(label(-50_000, -1_000_000)).toBe("Net worth worsened by more than 10×");
  });

  it("keeps up by more than 10× above zero, and says down by more than 90% for a fall to under a tenth", () => {
    expect(label(50_000, 1_000_000)).toBe("Net worth up by more than 10×");
    expect(label(1_000_000, 50_000)).toBe("Net worth down by more than 90%");
  });
});

describe("paid off since the peak needs three months of falling", () => {
  /** Owed peaks in January and stays there, then falls by 10% of the peak in each of the last `falls` months. */
  const cardsOwing = (falls: number) => {
    const movement: MovementRow[] = [row("2026-01", "visa", -500_000, { categoryId: "food" }), ...months(1, 10).map((m) => row(m, "chk", 10_000))];
    for (const m of months(11 - falls, 10)) movement.push(...pay(m, "chk", "visa", 50_000));
    return card(progressView(inputOf(factsOf([chk, visa], movement))), "debt")!.choices[0];
  };

  it("shows the percentage after three falling months, and the run", () => {
    const c = cardsOwing(3);
    expect(c.labels.map((l) => l.on)).toEqual(["30.0% paid off since the peak in Jan 2026", "Lower 3 months in a row"]);
  });

  it("shows no such line after two falling months", () => {
    const c = cardsOwing(2);
    expect(c.labels.map((l) => l.on)).toEqual(["Lower 2 months in a row"]);
    expect(JSON.stringify(c.labels)).not.toContain("paid off since");
    expect(cardsOwing(1).labels).toEqual([]);
  });

  it("holds back the 25, 50 and 75% loan milestones the same way", () => {
    // 20,000.00 owed, paid down by a quarter in each of the last `falls` months.
    const loanFacts = (falls: number) => factsOf([chk, mortgage], [...months(1, 10).map((m) => row(m, "chk", 100_000_000)), ...months(11 - falls, 10).flatMap((m) => pay(m, "chk", "mortgage", 5_000_000))], [{ accountId: "mortgage", amountMinor: -20_000_000 }]);
    const list = (falls: number) => (card(progressView(inputOf(loanFacts(falls), { buffer: { state: "unavailable", reason: "x" } })), "milestones") as MilestonesCard).items.map((i) => i.on).filter((l) => l.includes("of loans paid off"));
    expect(list(3)).toEqual(["75% of loans paid off since the peak: Oct 2026", "50% of loans paid off since the peak: Sep 2026", "25% of loans paid off since the peak: Aug 2026"]);
    expect(list(2)).toEqual([]);
  });

  it("counts the falls up to the month it was paid off", () => {
    const f = factsOf([chk, mortgage], [...months(1, 10).map((m) => row(m, "chk", 0)), ...pay("2026-02", "chk", "mortgage", 100_000), ...pay("2026-03", "chk", "mortgage", 100_000), ...pay("2026-04", "chk", "mortgage", 100_000)], [{ accountId: "mortgage", amountMinor: -300_000 }]);
    const loans = card(progressView(inputOf(f)), "debt")!.choices[0];
    expect(loans.labels.map((l) => l.on)).toContain("Lower 3 months in a row");
  });
});

describe("small wording and drawing fixes", () => {
  it("says years beyond 24 months in the debt-free label", () => {
    const owed = factsOf([chk, mortgage], months(1, 10).flatMap((m) => pay(m, "chk", "mortgage", 100_000)), [{ accountId: "mortgage", amountMinor: -50_000_000 }]);
    const free = (date: string) => card(progressView(inputOf(owed, { schedules: [{ accountId: "mortgage", state: "ready", principalNext12Minor: 1, costNext12Minor: 1, payoffDate: date }] })), "debt")!.choices.find((c) => c.id === "loans")!.labels.at(-1)!;
    expect(free("2048-12-15")).toEqual({ on: "Debt-free in about 22 years (Dec 2048)", off: "Debt-free in about 22 years" });
    expect(free("2028-11-15").on).toBe("Debt-free in about 24 months (Nov 2028)");
    expect(free("2028-12-15").on).toBe("Debt-free in about 2 years (Dec 2028)");
  });

  it("adds a note when a month is drawn at -100%, and none otherwise", () => {
    const low = factsOf([chk], months(1, 10).flatMap((m, i) => [row(m, "chk", 1_000, { categoryId: "salary" }), row(m, "chk", i === 4 ? -5_000 : -500, { categoryId: "food" })]));
    expect(card(progressView(inputOf(low)), "savings")!.belowNote).toBe("Months below −100% are drawn at −100%");
    expect(card(progressView(inputOf(richFacts())), "savings")!.belowNote).toBeNull();
  });

  it("puts the peak dot on the highest complete month, as the label does, not on a larger partial month", () => {
    // Owed climbs to a peak in March, falls, and the partial current month is higher than any.
    const movement: MovementRow[] = [row("2026-03", "visa", -300_000, { categoryId: "food" }), row("2026-11", "visa", -900_000, { categoryId: "food" }), ...months(1, 11).map((m) => row(m, "chk", 1_000))];
    const input = inputOf(factsOf([chk, visa], movement), {}, ["2026-01", "2026-11"]);
    const cards = card(progressView(input), "debt")!.choices[0];
    expect(input.period.partial).toBe(true);
    expect(cards.peak).toBe(2);
  });

  it("says once that the home cards are unavailable when property values could not be read", () => {
    const view = progressView(inputOf(richFacts(), { equity: [], equityFailed: true }));
    expect(view.equityUnavailable).toBe(true);
    expect(view.equityPending).toBe(false);
    expect(progressView(inputOf(richFacts(), { equity: [home("a", ltvTen)] })).equityUnavailable).toBe(false);
  });
});
