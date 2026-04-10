import { importSchedulesFromCsv } from "./schedulesCsvImport";
import { csvField } from "@/lib/csv";
import type { StagedMap } from "@/types/staged";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const emptyMaps = {
  payees: {} as StagedMap<{ id: string; name: string }>,
  accounts: {} as StagedMap<{ id: string; name: string }>,
};

function makePayeeMaps(entries: { id: string; name: string }[]): StagedMap<{ id: string; name: string }> {
  const map: StagedMap<{ id: string; name: string }> = {};
  for (const e of entries) {
    map[e.id] = { entity: e, original: e, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} };
  }
  return map;
}

function makeAccountMaps(entries: { id: string; name: string }[]): StagedMap<{ id: string; name: string }> {
  const map: StagedMap<{ id: string; name: string }> = {};
  for (const e of entries) {
    map[e.id] = { entity: e, original: e, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {} };
  }
  return map;
}

// ─── Error cases ──────────────────────────────────────────────────────────────

describe("importSchedulesFromCsv — error cases", () => {
  it("returns error when CSV has no data rows", () => {
    const result = importSchedulesFromCsv("id,date\n", emptyMaps);
    expect("error" in result).toBe(true);
  });

  it("returns error when CSV is completely empty", () => {
    const result = importSchedulesFromCsv("", emptyMaps);
    expect("error" in result).toBe(true);
  });

  it("returns error when date column is missing", () => {
    const result = importSchedulesFromCsv("id,name\nsched-1,Rent\n", emptyMaps);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("date");
  });
});

// ─── Valid rows ───────────────────────────────────────────────────────────────

describe("importSchedulesFromCsv — valid rows", () => {
  it("parses a minimal row with only a date column", () => {
    const csv = "date\n2025-03-01\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.schedules).toHaveLength(1);
      expect(result.schedules[0]!.date).toBe("2025-03-01");
      expect(result.skipped).toBe(0);
    }
  });

  it("parses the name column", () => {
    const csv = "date,name\n2025-03-01,Monthly Rent\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.name).toBe("Monthly Rent");
    }
  });

  it("assigns a new id (not the one in the CSV)", () => {
    const csv = "id,date\nold-id,2025-03-01\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.id).not.toBe("old-id");
      expect(result.schedules[0]!.id.length).toBeGreaterThan(0);
    }
  });

  it("parses posts_transaction as true", () => {
    const csv = "date,posts_transaction\n2025-03-01,true\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.postsTransaction).toBe(true);
    }
  });

  it("ignores completed column and always sets completed to false", () => {
    const csv = "date,completed\n2025-03-01,true\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.completed).toBe(false);
    }
  });

  it("defaults posts_transaction and completed to false when absent", () => {
    const csv = "date\n2025-03-01\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.postsTransaction).toBe(false);
      expect(result.schedules[0]!.completed).toBe(false);
    }
  });
});

// ─── Amount parsing ───────────────────────────────────────────────────────────

describe("importSchedulesFromCsv — amount parsing", () => {
  it("parses an exact amount in cents", () => {
    const csv = "date,amount,amountop\n2025-01-01,120000,is\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.amount).toBe(120000);
      expect(result.schedules[0]!.amountOp).toBe("is");
    }
  });

  it("parses an isapprox amount", () => {
    const csv = "date,amount,amountop\n2025-01-01,50000,isapprox\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.amountOp).toBe("isapprox");
    }
  });

  it("parses an isbetween range as num1|num2", () => {
    const csv = "date,amount,amountop\n2025-01-01,10000|20000,isbetween\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      const amount = result.schedules[0]!.amount;
      expect(typeof amount).toBe("object");
      if (typeof amount === "object" && amount !== null && "num1" in amount) {
        expect(amount.num1).toBe(10000);
        expect(amount.num2).toBe(20000);
      }
    }
  });

  it("skips amount when amountOp is invalid", () => {
    const csv = "date,amount,amountop\n2025-01-01,50000,unknown\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.amount).toBeUndefined();
      expect(result.schedules[0]!.amountOp).toBeUndefined();
    }
  });
});

// ─── Date parsing ─────────────────────────────────────────────────────────────

describe("importSchedulesFromCsv — date parsing", () => {
  it("accepts a JSON-encoded RecurConfig as the date", () => {
    const recurJson = JSON.stringify({ frequency: "monthly", interval: 1, start: "2025-01-01", endMode: "never" });
    // Use csvField to produce properly RFC-4180 escaped output (inner quotes become "")
    const csv = `date\n${csvField(recurJson)}\n`;
    const result = importSchedulesFromCsv(csv, emptyMaps);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.schedules).toHaveLength(1);
      expect(typeof result.schedules[0]!.date).toBe("object");
    }
  });

  it("skips rows with missing date", () => {
    const csv = "date,name\n,Rent\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules).toHaveLength(0);
      expect(result.skipped).toBe(1);
    }
  });

  it("skips rows with invalid JSON date that is not an ISO date", () => {
    const csv = "date\nnot-a-date-or-json\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules).toHaveLength(0);
      expect(result.skipped).toBe(1);
    }
  });

  it("skips rows with JSON that has no frequency field", () => {
    const csv = `date\n"${JSON.stringify({ foo: "bar" })}"\n`;
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules).toHaveLength(0);
      expect(result.skipped).toBe(1);
    }
  });
});

// ─── Entity name resolution ───────────────────────────────────────────────────

describe("importSchedulesFromCsv — entity resolution", () => {
  it("resolves payee name to id", () => {
    const csv = "date,payee\n2025-01-01,Amazon\n";
    const maps = {
      payees: makePayeeMaps([{ id: "payee-1", name: "Amazon" }]),
      accounts: emptyMaps.accounts,
    };
    const result = importSchedulesFromCsv(csv, maps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.payeeId).toBe("payee-1");
    }
  });

  it("resolves payee name case-insensitively", () => {
    const csv = "date,payee\n2025-01-01,amazon\n";
    const maps = {
      payees: makePayeeMaps([{ id: "payee-1", name: "Amazon" }]),
      accounts: emptyMaps.accounts,
    };
    const result = importSchedulesFromCsv(csv, maps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.payeeId).toBe("payee-1");
    }
  });

  it("sets payeeId to null when name does not match any payee", () => {
    const csv = "date,payee\n2025-01-01,Unknown Payee\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.payeeId).toBeNull();
    }
  });

  it("sets payeeId to null for deleted payees (excluded from lookup)", () => {
    const csv = "date,payee\n2025-01-01,Amazon\n";
    const maps = {
      payees: {
        "payee-1": { entity: { id: "payee-1", name: "Amazon" }, original: { id: "payee-1", name: "Amazon" }, isNew: false, isUpdated: false, isDeleted: true, validationErrors: {} },
      } as StagedMap<{ id: string; name: string }>,
      accounts: emptyMaps.accounts,
    };
    const result = importSchedulesFromCsv(csv, maps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.payeeId).toBeNull();
    }
  });

  it("resolves account name to id", () => {
    const csv = "date,account\n2025-01-01,Checking\n";
    const maps = { payees: emptyMaps.payees, accounts: makeAccountMaps([{ id: "acct-1", name: "Checking" }]) };
    const result = importSchedulesFromCsv(csv, maps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.accountId).toBe("acct-1");
    }
  });

  it("resolves account name case-insensitively", () => {
    const csv = "date,account\n2025-01-01,checking\n";
    const maps = { payees: emptyMaps.payees, accounts: makeAccountMaps([{ id: "acct-1", name: "Checking" }]) };
    const result = importSchedulesFromCsv(csv, maps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.accountId).toBe("acct-1");
    }
  });

  it("sets accountId to null when name does not match any account", () => {
    const csv = "date,account\n2025-01-01,Unknown Bank\n";
    const result = importSchedulesFromCsv(csv, emptyMaps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.accountId).toBeNull();
    }
  });

  it("sets accountId to null for deleted accounts (excluded from lookup)", () => {
    const csv = "date,account\n2025-01-01,Checking\n";
    const maps = {
      payees: emptyMaps.payees,
      accounts: {
        "acct-1": { entity: { id: "acct-1", name: "Checking" }, original: { id: "acct-1", name: "Checking" }, isNew: false, isUpdated: false, isDeleted: true, validationErrors: {} },
      } as StagedMap<{ id: string; name: string }>,
    };
    const result = importSchedulesFromCsv(csv, maps);
    if (!("error" in result)) {
      expect(result.schedules[0]!.accountId).toBeNull();
    }
  });
});
