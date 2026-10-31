import { resetAppDbForTests } from "@/lib/app-db/connection";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { addMonths } from "@/lib/financial-models/calendar/dates";
import { projectStoredDebt } from "./projectionService";
import { summarizeStoredLoan } from "./loanSummaryService";
import { createDebtConfiguration } from "./debtConfigService";
import { debtConfig, directory, saveInput, tempDebtDb } from "../testing/debtFixtures";

jest.mock("./projectionService", () => {
  const actual = jest.requireActual<typeof import("./projectionService")>("./projectionService");
  return { ...actual, projectStoredDebt: jest.fn(actual.projectStoredDebt) };
});

let db: SqliteDatabase;

beforeEach(() => {
  db = tempDebtDb();
});

afterEach(() => {
  jest.restoreAllMocks();
  resetAppDbForTests();
});

describe("summarizeStoredLoan", () => {
  it("includes interest on the 12-month cutoff date and excludes interest after it", () => {
    const debt = createDebtConfiguration(db, saveInput({ config: debtConfig() }), directory());
    const today = "2024-02-29";
    const cutoff = addMonths(today, 12);
    const afterCutoff = addMonths(cutoff, 1);
    const baseProjection = projectStoredDebt(db, debt.debt.id, {
      from: "0001-01-01",
      to: "2084-12-31",
      resolution: "events",
    });

    expect(baseProjection.ok).toBe(true);
    if (!baseProjection.ok || !baseProjection.projection.ok) throw new Error("Expected a valid loan projection.");
    const template = baseProjection.projection.events[0];
    if (!template) throw new Error("Expected the loan projection to contain an event.");
    const events = [
      { ...template, date: cutoff, eventType: "interest-charge" as const, interestMinor: 125 },
      { ...template, date: afterCutoff, eventType: "interest-charge" as const, interestMinor: 250 },
    ];
    jest.mocked(projectStoredDebt).mockReturnValue({
      ...baseProjection,
      projection: { ...baseProjection.projection, events },
    });

    const result = summarizeStoredLoan(db, debt.debt.id, { today });

    expect(result).toMatchObject({ ok: true, summary: { interestNext12MonthsMinor: 125 } });
  });
});
