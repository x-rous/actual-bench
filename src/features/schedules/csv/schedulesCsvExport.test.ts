import { exportSchedulesToCsv } from "./schedulesCsvExport";
import { parseCsvLine } from "@/lib/csv";
import type { StagedMap } from "@/types/staged";
import type { Schedule } from "@/types/entities";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStaged(schedules: Schedule[]): StagedMap<Schedule> {
  const map: StagedMap<Schedule> = {};
  for (const s of schedules) {
    map[s.id] = { entity: s, original: s, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} };
  }
  return map;
}

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.split("\n").filter(Boolean);
  const headers = parseCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

const baseSchedule: Schedule = {
  id: "sched-1",
  name: "Monthly Rent",
  date: "2025-01-01",
  postsTransaction: false,
  completed: false,
  payeeId: null,
  accountId: null,
};

const emptyMaps = {
  payees: {} as StagedMap<{ id: string; name: string }>,
  accounts: {} as StagedMap<{ id: string; name: string }>,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("exportSchedulesToCsv", () => {
  it("produces a header row and one data row", () => {
    const csv = exportSchedulesToCsv(makeStaged([baseSchedule]), emptyMaps);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("date");
  });

  it("excludes deleted entries", () => {
    const staged = makeStaged([baseSchedule]);
    staged["sched-1"]!.isDeleted = true;
    const csv = exportSchedulesToCsv(staged, emptyMaps);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1); // header only
  });

  it("serializes a one-time ISO date as a plain string", () => {
    const csv = exportSchedulesToCsv(makeStaged([baseSchedule]), emptyMaps);
    expect(csv).toContain("2025-01-01");
  });

  it("serializes a recurring date as JSON", () => {
    const s: Schedule = {
      ...baseSchedule,
      date: { frequency: "monthly", interval: 1, start: "2025-01-01", endMode: "never" },
    };
    const csv = exportSchedulesToCsv(makeStaged([s]), emptyMaps);
    expect(csv).toContain('"frequency"');
    expect(csv).toContain("monthly");
  });

  it("formats exact amount as cent integer", () => {
    const s: Schedule = { ...baseSchedule, amount: 120000, amountOp: "is" };
    const rows = parseCsv(exportSchedulesToCsv(makeStaged([s]), emptyMaps));
    expect(rows[0]!["amount"]).toBe("120000");
    expect(rows[0]!["amountOp"]).toBe("is");
  });

  it("formats isapprox amount correctly", () => {
    const s: Schedule = { ...baseSchedule, amount: 50000, amountOp: "isapprox" };
    const rows = parseCsv(exportSchedulesToCsv(makeStaged([s]), emptyMaps));
    expect(rows[0]!["amountOp"]).toBe("isapprox");
  });

  it("formats isbetween amount as 'num1|num2'", () => {
    const s: Schedule = { ...baseSchedule, amount: { num1: 10000, num2: 20000 }, amountOp: "isbetween" };
    const rows = parseCsv(exportSchedulesToCsv(makeStaged([s]), emptyMaps));
    expect(rows[0]!["amount"]).toBe("10000|20000");
  });

  it("resolves payee name from maps", () => {
    const s: Schedule = { ...baseSchedule, payeeId: "payee-1" };
    const maps = {
      payees: {
        "payee-1": { entity: { id: "payee-1", name: "Amazon" }, original: { id: "payee-1", name: "Amazon" }, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} },
      } as StagedMap<{ id: string; name: string }>,
      accounts: emptyMaps.accounts,
    };
    const rows = parseCsv(exportSchedulesToCsv(makeStaged([s]), maps));
    expect(rows[0]!["payee"]).toBe("Amazon");
  });

  it("resolves account name from maps", () => {
    const s: Schedule = { ...baseSchedule, accountId: "acct-1" };
    const maps = {
      payees: emptyMaps.payees,
      accounts: {
        "acct-1": { entity: { id: "acct-1", name: "Checking" }, original: { id: "acct-1", name: "Checking" }, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} },
      } as StagedMap<{ id: string; name: string }>,
    };
    const rows = parseCsv(exportSchedulesToCsv(makeStaged([s]), maps));
    expect(rows[0]!["account"]).toBe("Checking");
  });

  it("outputs empty strings for missing payee/account", () => {
    const rows = parseCsv(exportSchedulesToCsv(makeStaged([baseSchedule]), emptyMaps));
    expect(rows[0]!["payee"]).toBe("");
    expect(rows[0]!["account"]).toBe("");
  });

  it("serializes posts_transaction flag", () => {
    const s: Schedule = { ...baseSchedule, postsTransaction: true };
    const csv = exportSchedulesToCsv(makeStaged([s]), emptyMaps);
    expect(csv).toContain("true");
  });

  it("serializes completed flag", () => {
    const s: Schedule = { ...baseSchedule, completed: true };
    const csv = exportSchedulesToCsv(makeStaged([s]), emptyMaps);
    expect(csv).toContain("true");
  });
});
