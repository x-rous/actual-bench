import { backtestProposal } from "./patternBacktest";
import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";
import type { RuleGapProposal } from "./ruleGaps";

// Relative, as the other suites here do: the `@/` alias does not resolve
// inside `jest.mock`, which is hoisted above the module mapper.
jest.mock("../../../lib/api/query", () => ({ runQuery: jest.fn() }));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const connection = { id: "c1" } as ConnectionInstance;

function rows(data: Record<string, unknown>[]) {
  mockRunQuery.mockResolvedValue({ data } as never);
}

const contains: RuleGapProposal = {
  shape: "matches",
  field: "imported_payee",
  candidate: {
    field: "imported_payee",
    op: "contains",
    value: "ADNOC",
    description: 'contains "ADNOC"',
  },
  score: {
    candidate: {
      field: "imported_payee",
      op: "contains",
      value: "ADNOC",
      description: 'contains "ADNOC"',
    },
    expectedMatches: 0,
    unexpectedMatches: 0,
    unexpectedExamples: [],
    matchedTexts: 0,
  },
  extendsRule: null,
};

beforeEach(() => mockRunQuery.mockReset());

describe("checking a proposal against the whole budget", () => {
  it("pushes the condition into the query rather than reading the history back", async () => {
    rows([]);
    await backtestProposal(connection, contains, "p1", "ADNOC Fuel Station");

    // The whole point: the cost is the size of the answer, not of the budget.
    // `contains` is what Actual compiles a contains condition to, so the
    // backtest and the rule it is testing cannot disagree.
    expect(mockRunQuery).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({
        ActualQLquery: expect.objectContaining({
          filter: { imported_payee: { $like: "%ADNOC%" } },
        }),
      })
    );
  });

  it("uses a regular expression for a matches proposal", async () => {
    rows([]);
    await backtestProposal(
      connection,
      { ...contains, candidate: { ...contains.candidate, op: "matches", value: "ADN.*C" } },
      "p1",
      "ADNOC Fuel Station"
    );

    expect(mockRunQuery).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({
        ActualQLquery: expect.objectContaining({
          filter: { imported_payee: { $regexp: "ADN.*C" } },
        }),
      })
    );
  });

  it("attributes a payee's own transactions by name as well as by id", async () => {
    // A grouped query can return either depending on how the field serializes.
    // Comparing ids alone reported every one of this payee's transactions as
    // belonging to somebody else, turning a safe rule into a budget-wide alarm.
    rows([
      // Attributed by name: the id column came back as something else entirely.
      {
        imported_payee: "ADNOC AL",
        payee: "internal-42",
        "payee.name": "ADNOC Fuel Station",
        transactionCount: 20,
      },
      // Attributed by id, with no name column at all.
      { imported_payee: "ADNOC PC", payee: "p1", transactionCount: 5 },
    ]);

    const result = await backtestProposal(connection, contains, "p1", "ADNOC Fuel Station");

    expect(result.expected).toBe(25);
    expect(result.others).toEqual([]);
  });

  it("keeps transactions with no payee apart from a real collision", async () => {
    // A row with no payee is not being taken from anyone: setting a payee on it
    // is what the rule is for. Reported together they read as a warning.
    rows([
      { imported_payee: "ADNOC AL", payee: "p1", transactionCount: 20 },
      { imported_payee: "ADNOC QALA", payee: null, transactionCount: 3 },
      {
        imported_payee: "ADNOC RENTALS",
        payee: "p2",
        "payee.name": "ADNOC Rentals",
        transactionCount: 4,
      },
    ]);

    const result = await backtestProposal(connection, contains, "p1", "ADNOC Fuel Station");

    expect(result.expected).toBe(20);
    expect(result.others).toEqual([
      expect.objectContaining({ payeeName: "ADNOC Rentals", transactionCount: 4 }),
    ]);
    expect(result.unassigned).toEqual(
      expect.objectContaining({ transactionCount: 3, texts: ["ADNOC QALA"] })
    );
  });

  it("groups a payee's matches and lists its commonest text first", async () => {
    rows([
      { imported_payee: "ADNOC RARE", payee: "p2", "payee.name": "Other", transactionCount: 1 },
      { imported_payee: "ADNOC COMMON", payee: "p2", "payee.name": "Other", transactionCount: 9 },
    ]);

    const result = await backtestProposal(connection, contains, "p1", "ADNOC Fuel Station");

    expect(result.others).toHaveLength(1);
    expect(result.others[0].transactionCount).toBe(10);
    expect(result.others[0].texts).toEqual(["ADNOC COMMON", "ADNOC RARE"]);
  });
});
