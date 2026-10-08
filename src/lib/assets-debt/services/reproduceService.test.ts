import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { byKind, createScenario } from "../testing/postingScenario";
import { reproducePosting } from "./reproduceService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** T135: reproduction from stored inputs, with no transport at all (FR-182, FR-183, SC-005). */
describe("reproduce service", () => {
  it("an applied interest charge and an applied split reproduce exactly with transport = undefined", async () => {
    const b = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const charges = byKind((await b.preview({ from: "2024-02-01", to: "2024-04-30" })).postings, "interest-charge");
    expect(charges.length).toBeGreaterThan(1);
    for (const charge of charges) await b.apply(charge);
    mockApiRequest.mockImplementation(() => { throw new Error("reproduction must not reach Actual"); });
    for (const charge of charges) {
      const result = reproducePosting(b.db, charge.id, undefined);
      expect(result).toMatchObject({ status: "exact-match" });
      expect(result!.recomputed).toEqual(result!.stored);
    }
    expect(reproducePosting(b.db, charges[1].id)?.continuity).toBe("continuous");

    const a = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    a.seedPayment("2024-02-01");
    const [split] = byKind((await a.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    await a.apply(split);
    mockApiRequest.mockImplementation(() => { throw new Error("reproduction must not reach Actual"); });
    expect(reproducePosting(a.db, split.id, undefined)).toMatchObject({ status: "exact-match" });
  });

  it("a stored result that the engine no longer produces is reported as a mismatch, never hidden", async () => {
    const b = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const [charge] = byKind((await b.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    await b.apply(charge);
    // Simulate a recorded component version this build cannot call.
    b.db.exec("DROP TRIGGER financial_postings_identity_immutable");
    b.db.prepare("UPDATE financial_postings SET engine_versions_json = ? WHERE id = ?").run(JSON.stringify({ projection: "projection@2", "loan-daily": "loan-daily@99" }), charge.id);
    expect(reproducePosting(b.db, charge.id)).toMatchObject({ status: "not-reproducible" });
  });
});
