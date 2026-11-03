import { EXACT_ROW_CAP, PICKER_PAGE_SIZE, emptyFilterState, fetchAllRows } from "./transactionPickerQuery";

jest.mock("@/lib/api/query", () => ({ runQuery: jest.fn() }));
const runQuery = jest.requireMock("@/lib/api/query").runQuery as jest.Mock;

const page = (size: number) => ({ data: Array.from({ length: size }, (_, i) => ({ id: `r${i}`, date: "2026-01-01", account: "a", amount: -100 })) });
const read = () => fetchAllRows({ id: "c" } as never, emptyFilterState(), {}, "2026-10-26");
beforeEach(() => runQuery.mockReset());

describe("reading every row for exact charts", () => {
  it("is not truncated when a short page ends the rows", async () => {
    runQuery.mockResolvedValueOnce(page(PICKER_PAGE_SIZE)).mockResolvedValueOnce(page(10));
    const result = await read();
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(PICKER_PAGE_SIZE + 10);
  });

  it("is not truncated when there are exactly as many rows as the cap, which one more page proves", async () => {
    let calls = 0;
    runQuery.mockImplementation(async () => (++calls <= EXACT_ROW_CAP / PICKER_PAGE_SIZE ? page(PICKER_PAGE_SIZE) : page(0)));
    const result = await read();
    expect(result.rows).toHaveLength(EXACT_ROW_CAP);
    expect(result.truncated).toBe(false);
  });

  it("is truncated only when a row exists beyond the cap", async () => {
    runQuery.mockResolvedValue(page(PICKER_PAGE_SIZE));
    const result = await read();
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(EXACT_ROW_CAP);
  });
});
