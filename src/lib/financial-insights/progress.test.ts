import { cashBuffer, savingsRateOf, type LoanScheduleInput, type MovementRow } from "./measures";
import { changeBetween, progressView, safeReason, toShape, type DebtCard, type ProgressInput, type ProgressView, type SavingsCard } from "./progress";
import type { ScheduleInput } from "./debt";
import type { ConsistencyCard, CompositionCard, JourneyCard } from "./progress";
import { AMOUNTS_MINOR, AMOUNTS_TEXT, NAMES, car, chk, inv, factsOf, home, owned, inputOf, ltvTen, mortgage, months, pay, richFacts, row, today, visa } from "./testing/progressFixture";

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
  const SHAPE_KEYS = new Set(["points", "bars", "zero", "fill", "accessibleFill", "at", "start", "end"]);
  const NUMBER_KEYS = new Set([...SHAPE_KEYS, "peak", "index"]);

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
    return progressView(inputOf(facts, { schedules, equity: [home("a", ltvTen), home("b", ltvTen.map((v) => v + 5), "other-asset")] }));
  }

  it("holds only Shape, Percent, Months and Count numbers, with no field named for an amount, and every Shape between -1 and 1", () => {
    const view = everything();
    expect(view.cards.map((c) => c.kind)).toEqual(["netWorth", "debt", "property", "property", "composition", "savings", "consistency", "journey", "buffer"]);
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
    const lines = view.cards.flatMap((c) => ("labels" in c ? c.labels : []));
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
    expect(savings.labels.map((l) => l.on)).toContain("7 months in a row above 0%");
  });

  it("leaves a month with no income as a gap with a note, and still has the card, with its reason, when no month had income", () => {
    const movement = [row("2026-01", "chk", 4_000_000, { categoryId: "salary" }), row("2026-01", "chk", -1_000_000, { categoryId: "food" }), row("2026-02", "chk", -200_000, { categoryId: "food" })];
    const savings = card(progressView(inputOf(factsOf([chk], movement), {}, ["2026-01", "2026-02"])), "savings")!;
    expect(savings.bars).toEqual([0.75, null]);
    expect(savings.gapNote).toBe("Months with no income are left blank");
    const none = progressView(inputOf(factsOf([chk], [row("2026-01", "chk", -100, { categoryId: "food" })]), {}, ["2026-01", "2026-02"]));
    const empty = card(none, "savings")!;
    expect(empty.empty).toBe("There was no income in this period");
    expect(empty.bars.every((b) => b === null)).toBe(true);
    // The reason is said once: in the card's own line, not also as a label.
    expect(empty.labels).toEqual([]);
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
    expect(savings.labels.map((l) => l.on).join()).toContain("10 months in a row above 0%");
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

describe("property value and loan-to-value", () => {
  it("makes one card per property, titled by kind with its value and loan-to-value, and numbered when two read the same", () => {
    const view = progressView(inputOf(richFacts(), { equity: [home("a", ltvTen), home("b", ltvTen), home("c", ltvTen, "vehicle"), home("d", ltvTen, "other-asset"), owned("e", [100, 110, 120, 130, 140, 150, 160, 170, 180, 190])] }));
    const cards = view.cards.filter((c) => c.kind === "property");
    expect(cards.map((c) => c.title)).toEqual(["Property value & LTV 1", "Property value & LTV 2", "Asset value & LTV", "Property value"]);
    const first = cards[0] as Extract<typeof cards[number], { kind: "property" }>;
    expect(first.ltv!.chart.points.at(-1)).toBe(0.614);
    expect(first.ltv!.reference).toEqual({ at: 0.8, label: "80%" });
    // The value is a shape scaled to its own highest month: the last month is 1, and no amount is in it.
    expect(first.valueShape!.points.at(-1)).toBe(1);
    expect(first.labels.map((l) => l.on)).toEqual(["You own 38.6%", "Value up 16.6% over the period", "LTV down from 72.0% to 61.4%"]);
  });

  it("draws no card for a vehicle, with or without a loan", () => {
    const view = progressView(inputOf(richFacts(), { equity: [home("v", ltvTen, "vehicle"), owned("w", [100, 110, 120, 130, 140, 150, 160, 170, 180, 190], "vehicle")] }));
    expect(view.cards.filter((c) => c.kind === "property")).toEqual([]);
  });

  it("labels the latest loan-to-value at the end of its line, and the month it is for", () => {
    expect(card(progressView(inputOf(richFacts(), { equity: [home("a", ltvTen)] })), "property")!.ltv!.latest).toEqual({ index: 9, label: "61.4%" });
    expect(card(progressView(inputOf(richFacts(), { equity: [home("a", [85, 84, 83, 82, 81, 79, 78, 77, null, null])] })), "property")!.ltv!.latest).toEqual({ index: 7, label: "77.0%" });
  });

  it("shows a property with no loan as its value alone, and a fully paid loan as 100% owned", () => {
    const v = card(progressView(inputOf(richFacts(), { equity: [owned("a", [100, 100, 110, 120, 130, 140, 150, 160, 170, 180])] })), "property")!;
    expect(v.ltv).toBeNull();
    expect(v.title).toBe("Property value");
    expect(v.labels.map((l) => l.on)).toEqual(["Value up 80.0% over the period"]);
    const paid = card(progressView(inputOf(richFacts(), { equity: [home("a", Array(10).fill(0))] })), "property")!;
    expect(paid.labels[0].on).toBe("You own 100.0%");
    expect(paid.ltv!.chart.points.every((p) => p === 0)).toBe(true);
  });

  it("guards a change in value past ten times, and leaves a month before the asset had a value as a gap", () => {
    const big = card(progressView(inputOf(richFacts(), { equity: [owned("a", [null, null, 100, 200, 400, 800, 1_200, 1_600, 2_000, 4_000])] })), "property")!;
    expect(big.labels[0].on).toBe("Value up by more than 10×");
    expect(big.valueShape!.points.slice(0, 2)).toEqual([null, null]);
    const fall = card(progressView(inputOf(richFacts(), { equity: [owned("a", [1_000, 900, 800, 700, 600, 500, 400, 300, 200, 50])] })), "property")!;
    expect(fall.labels[0].on).toBe("Value down by more than 90%");
  });

  it("names the month it went below 80% for good, draws months with gaps as gaps, and is absent with nothing to show", () => {
    const view = progressView(inputOf(richFacts(), { equity: [home("a", [85, 84, null, 79, 78, 77, 76, 75, 74, 73])] }));
    const c = card(view, "property")!;
    expect(c.labels.map((l) => l.on)).toContain("Below 80% since Apr 2026");
    expect(c.ltv!.chart.points[2]).toBeNull();
    expect(c.valueShape!.points[2]).toBeNull();
    expect(card(progressView(inputOf(richFacts(), { equity: [home("a", Array(10).fill(null))] })), "property")).toBeUndefined();
    expect(card(progressView(inputOf(richFacts(), { equity: [owned("a", Array(10).fill(null))] })), "property")).toBeUndefined();
    expect(card(progressView(inputOf(richFacts(), { equity: [] })), "property")).toBeUndefined();
    expect(progressView(inputOf(richFacts(), { equity: null })).equityPending).toBe(true);
  });
});

describe("which cards appear", () => {
  it("hides the net worth card for a single month and keeps savings, buffer and milestones", () => {
    const view = progressView(inputOf(richFacts(), {}, ["2026-10", "2026-10"]));
    expect(view.cards.map((c) => c.kind)).toEqual(["composition", "savings", "buffer"]);
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

describe("review fixes: net worth from the opening balance", () => {
  const worth = (movement: MovementRow[], start: number, range: [string, string]) => card(progressView(inputOf(factsOf([chk], movement, [{ accountId: "chk", amountMinor: start }]), {}, range)), "netWorth")!;

  it("measures the change from the balance before the period, as Summary does", () => {
    // 100.00 at the end of January, then 110.00 and 120.00: Summary says +20%, not +9.1% from February's 110.00.
    const w = worth([row("2026-01", "chk", 0), row("2026-02", "chk", 1_000), row("2026-03", "chk", 1_000)], 10_000, ["2026-02", "2026-03"]);
    expect(w.labels[0].on).toBe("Net worth up 20.0% over the period");
  });

  it("names a crossing of zero in the first month of the period, and counts it as the first month when dates are hidden", () => {
    const w = worth([row("2026-01", "chk", 0), row("2026-02", "chk", 1_000), row("2026-03", "chk", 100)], -500, ["2026-02", "2026-03"]);
    expect(w.labels[0]).toEqual({ on: "Crossed zero in Feb 2026", off: "Crossed zero in the first month" });
  });
});

describe("review fixes: savings notes", () => {
  it("adds a share-safe warning when Summary's rate carries one, with no amount in it", () => {
    const input = inputOf(richFacts());
    const flagged = progressView({ ...input, summary: { ...input.summary, savingsRate: { state: "ready", value: 21.3, warning: "2 entries (987,654.32) are classified as capital" } } });
    const note = card(flagged, "savings")!.provisionalNote;
    expect(note).toBe("Some entries may be counted twice; see Summary");
    expect(JSON.stringify(flagged)).not.toContain("987");
    expect(card(progressView(input), "savings")!.provisionalNote).toBeNull();
  });

  it("says a month above 100% is drawn at 100%", () => {
    const f = factsOf([chk], months(1, 10).flatMap((m, i) => [row(m, "chk", 1_000, { categoryId: "salary" }), row(m, "chk", i === 3 ? 5_000 : -500, { categoryId: "food" })]));
    const savings = card(progressView(inputOf(f)), "savings")!;
    expect(savings.aboveNote).toBe("Months above 100% are drawn at 100%");
    expect(Math.max(...(savings.bars.filter((b) => b !== null) as number[]))).toBe(1);
    expect(card(progressView(inputOf(richFacts())), "savings")!.aboveNote).toBeNull();
  });
});

describe("review fixes: property loan-to-value", () => {
  const equity = (ltvs: (number | null)[]) => card(progressView(inputOf(richFacts(), { equity: [home("a", ltvs)] })), "property")!;

  it("dates the last known ownership when later months have no figure, and claims nothing about what held since", () => {
    const e = equity([85, 84, 83, 82, 81, 79, 78, 77, null, null]);
    expect(e.labels[0]).toEqual({ on: "You owned 23.0% in Aug 2026", off: "You owned 23.0% (Month 8)" });
    expect(e.labels.map((l) => l.on).join()).not.toContain("Below 80%");
  });

  it("keeps saying 'You own' when the latest month has its figure", () => {
    expect(equity(ltvTen).labels[0].on).toBe("You own 38.6%");
  });

  it("scales the chart to a loan above the value, so a fall from 150% to 120% shows", () => {
    const e = equity([150, 145, 140, 135, 130, 128, 126, 124, 122, 120]);
    expect(e.ltv!.chart.points[0]).toBe(1);
    expect(e.ltv!.chart.points.at(-1)).toBe(0.8);
    expect(e.ltv!.full).toEqual({ at: 0.667, label: "100%" });
    expect(e.ltv!.reference.at).toBe(0.533);
    expect(e.labels.map((l) => l.on)).toContain("LTV down from 150.0% to 120.0%");
  });

  it("keeps 100% at the top when no month is above the value", () => {
    expect(equity(ltvTen).ltv!.full).toEqual({ at: 1, label: "100%" });
  });
});

describe("savings consistency", () => {
  const consistency = (f = richFacts(), over: Partial<ProgressInput> = {}) => card(progressView(inputOf(f, over)), "consistency") as ConsistencyCard | undefined;

  it("counts the months saved of the months with income, and draws one square for each, in order", () => {
    const c = consistency()!;
    // March spent more than it received; every other month kept 25%.
    expect(c.strip).toEqual(["saved", "saved", "short", "saved", "saved", "saved", "saved", "saved", "saved", "saved"]);
    expect(c.labels.map((l) => l.on)).toEqual(["9 of 10 months saved", "90.0% positive months"]);
    expect(c.note).toBe("Last 10 complete months");
    expect(c.axis.months).toHaveLength(10);
  });

  it("marks a month with no income and leaves it out of the count", () => {
    const f = factsOf([chk], [...months(1, 3).flatMap((m) => [row(m, "chk", 4_000_000, { categoryId: "salary" }), row(m, "chk", -3_000_000, { categoryId: "food" })]), row("2026-04", "chk", -100, { categoryId: "food" })]);
    const c = consistency(f, {})!;
    expect(inputOf(f).period.months).toHaveLength(10);
    expect(c.strip.slice(0, 4)).toEqual(["saved", "saved", "saved", "none"]);
    expect(c.labels[0].on).toBe("3 of 3 months saved");
  });

  it("covers every complete month of the period, not only twelve, and leaves the partial month out", () => {
    const f = factsOf([chk], [...months(1, 11).flatMap((m) => [row(m, "chk", 4_000_000, { categoryId: "salary" }), row(m, "chk", -3_000_000, { categoryId: "food" })]), ...Array.from({ length: 8 }, (_, i) => row(`2025-0${i + 1}`, "chk", 4_000_000, { categoryId: "salary" }))]);
    const wide = card(progressView(inputOf(f, {}, ["2025-01", "2026-11"])), "consistency") as ConsistencyCard;
    // 2025-01 to 2026-10 is 22 complete months; November 2026 is the current month.
    expect(wide.strip).toHaveLength(22);
    expect(wide.note).toBe("22 complete months");
    expect(wide.axis.months).toHaveLength(22);
    expect(wide.axis.partial.every((p) => !p)).toBe(true);
  });

  it("draws at most the last 120 months, ten years", () => {
    const long = Array.from({ length: 130 }, (_, i) => `${2016 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`).filter((m) => m <= "2026-10");
    const f = factsOf([chk], long.flatMap((m) => [row(m, "chk", 4_000_000, { categoryId: "salary" }), row(m, "chk", -3_000_000, { categoryId: "food" })]));
    const c = card(progressView(inputOf(f, {}, ["2016-01", "2026-10"])), "consistency") as ConsistencyCard;
    expect(c.strip).toHaveLength(120);
    expect(c.note).toBe("Last 120 complete months");
    expect(c.axis.months[0].on).toBe("Nov 2016");
  });

  it("is absent with fewer than two months with income", () => {
    expect(consistency(factsOf([chk], [row("2026-10", "chk", 1_000, { categoryId: "salary" })]))).toBeUndefined();
  });

  it("moves the count off the savings rate card, which keeps the current run", () => {
    const labels = card(progressView(inputOf(richFacts())), "savings")!.labels.map((l) => l.on).join();
    expect(labels).not.toContain("months saved");
    expect(labels).not.toContain("Saved in");
  });
});

describe("asset composition", () => {
  /** 10,000.00 in checking at the end of January, then 5,000.00 moved into a brokerage in February. */
  const split = (): ProgressInput => inputOf(factsOf([chk, inv], [row("2026-01", "chk", 0), row("2026-02", "chk", 100), ...pay("2026-02", "chk", "inv", 500_000), row("2026-03", "chk", 100)], [{ accountId: "chk", amountMinor: 1_000_000 }]), {}, ["2026-02", "2026-03"]);
  const composition = (input: ProgressInput) => card(progressView(input), "composition") as CompositionCard | undefined;

  it("shows shares of what you own at the start and the end, adding up to 100%, in four fixed classes", () => {
    const c = composition(split())!;
    expect(c.classes).toEqual(["Cash & deposits", "Investments", "Property", "Other"]);
    expect(c.start).toEqual([1, 0, 0, 0]);
    expect(c.end[0]).toBe(0.5);
    expect(c.end[1]).toBe(0.5);
    expect(c.end.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    expect(c.startName).toBe("Start");
    expect(c.endName).toBe("End of period");
  });

  it("names the biggest shift and the largest holding now, in percent of what you own", () => {
    const c = composition(split())!;
    expect(c.labels.map((l) => l.on)).toEqual(["Cash & deposits down from 100.0% to 50.0% of what you own", "Largest now: Cash & deposits, 50.0%"]);
  });

  it("calls the end Today while the period's last month is the current one", () => {
    const input = inputOf(factsOf([chk, inv], [row("2026-10", "chk", 100), row("2026-11", "chk", 100)], [{ accountId: "chk", amountMinor: 100_000 }]), {}, ["2026-10", "2026-11"]);
    expect(input.period.partial).toBe(true);
    expect(composition(input)!.endName).toBe("Today");
  });

  it("is absent when nothing is owned, or when there is a single month and no history before it", () => {
    expect(composition(inputOf(factsOf([chk], months(1, 10).map((m) => row(m, "chk", 0)))))).toBeUndefined();
    expect(composition(inputOf(factsOf([chk], [row("2026-10", "chk", 500)]), {}, ["2026-10", "2026-10"]))).toBeUndefined();
  });

  it("never lets a negative balance count as owned", () => {
    const input = inputOf(factsOf([chk, inv], [row("2026-01", "chk", 0), row("2026-02", "chk", -400_000), row("2026-03", "chk", 0), row("2026-02", "inv", 300_000), row("2026-03", "inv", 0)], [{ accountId: "chk", amountMinor: 100_000 }]), {}, ["2026-02", "2026-03"]);
    expect(composition(input)!.end).toEqual([0, 1, 0, 0]);
  });
});

describe("cash buffer journey", () => {
  const journey = (over: Partial<ProgressInput> = {}) => card(progressView(inputOf(richFacts(), over)), "journey") as JourneyCard | undefined;
  const settings = (goalMonths: number | null) => ({ goalMonths, averageMonths: 12 as const, method: "average" as const });

  it("draws months of cover by month, from the same cash buffer measure, with a gap where it cannot be worked out", () => {
    const j = journey()!;
    // The first months have fewer than three complete months of history: a gap, never zero.
    expect(j.chart.points.slice(0, 3)).toEqual([null, null, null]);
    expect(j.chart.points.slice(3).every((p) => p !== null && p > 0 && p <= 1)).toBe(true);
    expect(j.chart.points.at(-1)).toBe(1);
    expect(j.labels[0].on).toMatch(/^Cover up from \d+\.\d to \d+\.\d months$/);
    expect(j.goal).toBeNull();
  });

  it("ends on the buffer Summary shows while the period's last month is the current one, because every month is the same measure", () => {
    const input = inputOf(richFacts(), {}, ["2026-01", "2026-11"]);
    expect(input.period.partial).toBe(true);
    expect(input.buffer.state).toBe("ready");
    const summary = Math.round((input.buffer as { value: { months: number } }).value.months * 10) / 10;
    const j = card(progressView(input), "journey") as JourneyCard;
    expect(j.labels[0].on).toMatch(new RegExp(` to ${summary.toFixed(1)} months$`));
    expect(j.axis.partial.at(-1)).toBe(true);
    expect(j.axis.partial.slice(0, -1).every((p) => !p)).toBe(true);
  });

  it("uses the tracked loans' schedules for every month, as Summary's buffer does, so the line is not on two bases", () => {
    const base = inputOf(richFacts(), {}, ["2026-01", "2026-11"]);
    const without = card(progressView(base), "journey") as JourneyCard;
    // The mortgage costs a small fixed amount a month on its schedule, against the large sums recorded into it.
    const schedules = new Map<string, LoanScheduleInput>([["mortgage", { state: "ready", monthlyMinor: 100 }], ["car", { state: "ready", monthlyMinor: 100 }]]);
    const withSchedules = card(progressView({ ...base, bufferSchedules: schedules, buffer: cashBuffer(base.ledger, today, schedules, {}) }), "journey") as JourneyCard;
    const lastMonths = (j: JourneyCard) => Number(/ to (\d+\.\d) months$/.exec(j.labels[0].on)![1]);
    // With the schedules the cover is larger, and the last point is still the buffer Summary would show.
    expect(lastMonths(withSchedules)).toBeGreaterThan(lastMonths(without));
    expect(lastMonths(withSchedules)).toBe(Math.round((cashBuffer(base.ledger, today, schedules, {}) as { value: { months: number } }).value.months * 10) / 10);
    expect(withSchedules.chart.points.at(-1)).toBe(1);
  });

  it("draws the goal from the settings, and says the month the cover reached it for good", () => {
    const j = journey({ bufferSettings: settings(24) })!;
    expect(j.goal).toEqual({ at: 0.96, label: "Goal" });
    expect(j.labels.map((l) => l.on).join()).toMatch(/Goal of 24 months reached in [A-Z][a-z]{2} 2026/);
    expect(j.labels.map((l) => l.off).join()).toMatch(/Goal of 24 months reached \(Month \d+\)/);
  });

  it("makes no claim of reaching a goal it was never below, or has not reached", () => {
    const always = journey({ bufferSettings: settings(5) })!;
    expect(always.goal!.at).toBe(0.2);
    expect(always.labels.map((l) => l.on).join()).not.toContain("Goal of");
    const never = journey({ bufferSettings: settings(60) })!;
    expect(never.goal!.at).toBe(1);
    expect(never.labels.map((l) => l.on).join()).not.toContain("Goal of");
  });

  it("is absent with fewer than three months of cover to draw", () => {
    expect(journey({ buffer: { state: "unavailable", reason: "x" } }, )).toBeDefined();
    expect(card(progressView(inputOf(richFacts(), {}, ["2026-09", "2026-10"])), "journey")).toBeUndefined();
  });
});

describe("review fixes: round two", () => {
  it("numbers property cards only when more than one is drawn", () => {
    // Two properties, one with nothing to draw: the other keeps its plain title.
    const view = progressView(inputOf(richFacts(), { equity: [owned("a", Array(10).fill(null)), home("b", ltvTen)] }));
    expect(view.cards.filter((c) => c.kind === "property").map((c) => c.title)).toEqual(["Property value & LTV"]);
  });

  it("finds a debt paid off in the first month of the period from the balance before it", () => {
    const f = factsOf([chk, mortgage], [...months(1, 4).map((m) => row(m, "chk", 100)), ...pay("2026-02", "chk", "mortgage", 100_000)], [{ accountId: "mortgage", amountMinor: -100_000 }]);
    const debt = card(progressView(inputOf(f, {}, ["2026-02", "2026-04"])), "debt") as DebtCard;
    expect(debt.choices.map((c) => c.id)).toEqual(["loans"]);
    const loans = debt.choices[0];
    expect(loans.labels[0]).toEqual({ on: "Paid off in Feb 2026", off: "Paid off in the first month" });
    // The line lies on zero: nothing was owed at any month of the period.
    expect(loans.chart.points.every((p) => p === 0)).toBe(true);
  });

  it("does not offer a debt that was already zero before the period", () => {
    const f = factsOf([chk, mortgage], months(1, 4).map((m) => row(m, "chk", 100)), [{ accountId: "mortgage", amountMinor: 0 }]);
    expect(card(progressView(inputOf(f, {}, ["2026-02", "2026-04"])), "debt")).toBeUndefined();
  });

  it("works out each journey month with the median spending the page supplies, when the typical month is the median", () => {
    const base = inputOf(richFacts(), {}, ["2026-01", "2026-10"]);
    const settings = { goalMonths: null, averageMonths: 12 as const, method: "median" as const };
    const calls: string[] = [];
    const j = (over: Partial<ProgressInput>) => card(progressView({ ...base, bufferSettings: settings, ...over }), "journey") as JourneyCard;
    const average = j({});
    const median = j({ medianSpendingAt: (day) => { calls.push(day); return 1_000_000; } });
    // Asked for each month of the line, and the answer is used: a huge typical spend leaves little cover.
    expect(calls.length).toBeGreaterThanOrEqual(median.chart.points.filter((p) => p !== null).length);
    expect(calls.every((d) => /^2026-\d\d-28$/.test(d))).toBe(true);
    expect(median.labels[0].on).not.toBe(average.labels[0].on);
    // The average method never asks.
    const none: string[] = [];
    card(progressView({ ...base, bufferSettings: { ...settings, method: "average" }, medianSpendingAt: (d) => { none.push(d); return 1; } }), "journey");
    expect(none).toEqual([]);
  });
});
