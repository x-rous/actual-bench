import { recurSummary, frequencyLabel } from "./recurSummary";
import type { RecurConfig } from "@/types/entities";

// ─── recurSummary ──────────────────────────────────────────────────────────────

describe("recurSummary", () => {
  it("returns empty string for undefined", () => {
    expect(recurSummary(undefined)).toBe("");
  });

  it("formats a one-time ISO date", () => {
    expect(recurSummary("2025-03-15")).toBe("On Mar 15, 2025");
  });

  // ── Daily ──────────────────────────────────────────────────────────────────

  it("formats daily with interval 1 as 'Daily'", () => {
    const cfg: RecurConfig = { frequency: "daily", interval: 1, start: "2025-01-01", endMode: "never" };
    expect(recurSummary(cfg)).toBe("Daily");
  });

  it("formats daily with interval > 1", () => {
    const cfg: RecurConfig = { frequency: "daily", interval: 3, start: "2025-01-01", endMode: "never" };
    expect(recurSummary(cfg)).toBe("Every 3 days");
  });

  // ── Weekly ─────────────────────────────────────────────────────────────────

  it("formats weekly with interval 1 and weekday anchor", () => {
    const cfg: RecurConfig = { frequency: "weekly", interval: 1, start: "2025-01-01", endMode: "never" };
    expect(recurSummary(cfg)).toBe("Weekly on Wednesday");
  });

  it("formats weekly with interval > 1 and weekday anchor", () => {
    const cfg: RecurConfig = { frequency: "weekly", interval: 2, start: "2025-01-01", endMode: "never" };
    expect(recurSummary(cfg)).toBe("Every 2 weeks on Wednesday");
  });

  // ── Yearly ─────────────────────────────────────────────────────────────────

  it("formats yearly with interval 1 and month/day anchor", () => {
    const cfg: RecurConfig = { frequency: "yearly", interval: 1, start: "2025-01-01", endMode: "never" };
    expect(recurSummary(cfg)).toBe("Yearly on Jan 1");
  });

  // ── Monthly — no pattern ──────────────────────────────────────────────────

  it("formats monthly with no pattern using the start-day anchor", () => {
    const cfg: RecurConfig = { frequency: "monthly", interval: 1, start: "2025-01-01", endMode: "never" };
    expect(recurSummary(cfg)).toBe("Monthly on the 1st");
  });

  it("formats monthly with interval > 1 and no pattern", () => {
    const cfg: RecurConfig = { frequency: "monthly", interval: 3, start: "2025-01-01", endMode: "never" };
    expect(recurSummary(cfg)).toBe("Every 3 months on the 1st");
  });

  it("formats monthly with last-day anchor when start is month end", () => {
    const cfg: RecurConfig = { frequency: "monthly", interval: 1, start: "2025-01-31", endMode: "never" };
    expect(recurSummary(cfg)).toBe("Monthly on the last day");
  });

  // ── Monthly — specific day pattern ────────────────────────────────────────

  it("formats monthly on a specific numbered day", () => {
    const cfg: RecurConfig = {
      frequency: "monthly", interval: 1, start: "2025-01-01", endMode: "never",
      patterns: [{ value: 15, type: "day" }],
    };
    expect(recurSummary(cfg)).toBe("Monthly on the 15th");
  });

  it("formats monthly on the last day", () => {
    const cfg: RecurConfig = {
      frequency: "monthly", interval: 1, start: "2025-01-01", endMode: "never",
      patterns: [{ value: -1, type: "day" }],
    };
    expect(recurSummary(cfg)).toBe("Monthly on the last day");
  });

  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [11, "11th"],
    [21, "21st"],
    [12, "12th"],
    [13, "13th"],
  ])("suffixes day %i as %s", (day, expected) => {
    // 11-13 are the cases a naive `n % 10` ordinal gets wrong, and 21 is the
    // case an over-correction for them gets wrong.
    const cfg: RecurConfig = {
      frequency: "monthly", interval: 1, start: "2025-01-01", endMode: "never",
      patterns: [{ value: day, type: "day" }],
    };
    expect(recurSummary(cfg)).toContain(expected);
  });

  // ── Monthly — day-of-week pattern ─────────────────────────────────────────

  it("formats monthly on the last Monday", () => {
    const cfg: RecurConfig = {
      frequency: "monthly", interval: 1, start: "2025-01-01", endMode: "never",
      patterns: [{ value: -1, type: "MO" }],
    };
    expect(recurSummary(cfg)).toBe("Monthly on the last Monday");
  });

  it("formats monthly on the 2nd Friday", () => {
    const cfg: RecurConfig = {
      frequency: "monthly", interval: 1, start: "2025-01-01", endMode: "never",
      patterns: [{ value: 2, type: "FR" }],
    };
    expect(recurSummary(cfg)).toBe("Monthly on the 2nd Friday");
  });

  // ── Weekend skip suffix ────────────────────────────────────────────────────

  it("appends weekend-before suffix when skipWeekend is true with 'before'", () => {
    const cfg: RecurConfig = {
      frequency: "monthly", interval: 1, start: "2025-01-01", endMode: "never",
      skipWeekend: true, weekendSolveMode: "before",
    };
    expect(recurSummary(cfg)).toContain("weekends → before");
  });

  it("appends weekend-after suffix when weekendSolveMode is 'after'", () => {
    const cfg: RecurConfig = {
      frequency: "monthly", interval: 1, start: "2025-01-01", endMode: "never",
      skipWeekend: true, weekendSolveMode: "after",
    };
    expect(recurSummary(cfg)).toContain("weekends → after");
  });

  // ── End mode suffixes ─────────────────────────────────────────────────────

  it("appends 'ends after N×' for after_n_occurrences end mode", () => {
    const cfg: RecurConfig = {
      frequency: "monthly", interval: 1, start: "2025-01-01",
      endMode: "after_n_occurrences", endOccurrences: 6,
    };
    expect(recurSummary(cfg)).toContain("ends after 6×");
  });

  it("appends formatted end date for on_date end mode", () => {
    const cfg: RecurConfig = {
      frequency: "monthly", interval: 1, start: "2025-01-01",
      endMode: "on_date", endDate: "2025-12-31",
    };
    expect(recurSummary(cfg)).toContain("ends Dec 31, 2025");
  });

  it("does not append end suffix when endMode is never", () => {
    const cfg: RecurConfig = { frequency: "weekly", interval: 1, start: "2025-01-01", endMode: "never" };
    expect(recurSummary(cfg)).not.toContain("ends");
  });
});

// ─── frequencyLabel ────────────────────────────────────────────────────────────

describe("frequencyLabel", () => {
  it.each([
    ["undefined (no recurrence at all)", undefined, "Once"],
    ["a plain ISO date", "2025-01-01", "Once"],
  ])("labels %s as %s", (_what, input, expected) => {
    expect(frequencyLabel(input as undefined | string)).toBe(expected);
  });

  it.each(["daily", "weekly", "monthly", "yearly"] as const)(
    "capitalises the %s frequency",
    (frequency) => {
      const cfg: RecurConfig = { frequency, interval: 1, start: "2025-01-01", endMode: "never" };
      const expected = frequency[0].toUpperCase() + frequency.slice(1);
      expect(frequencyLabel(cfg)).toBe(expected);
    }
  );
});
