import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import { resolvePeriod } from "./period";
import { readStatementEntries } from "./statementReads";

jest.mock("@/lib/actual", () => ({ getTransport: jest.fn() }));
const runQuery = jest.fn();
const period = resolvePeriod({ kind: "preset", id: "this-month" }, "2026-11-06", null);
const row = (id: string) => ({ id, date: "2026-11-02", account: "bank", category: "food", amount: -123, "payee.transfer_acct": null, "payee.name": null, transfer_id: null, parent_id: "split" });
beforeEach(() => { jest.clearAllMocks(); jest.mocked(getTransport).mockReturnValue({ runQuery } as unknown as ReturnType<typeof getTransport>); });

it.each(["browser-api", "http-api"])("uses the active %s transport with inline splits and sequential bounded pages", async (mode) => {
  runQuery.mockResolvedValueOnce({ data: Array.from({ length: 2000 }, (_, i) => row(`row-${i}`)) }).mockResolvedValueOnce({ data: [{ ...row("start"), "payee.name": "Starting Balance" }] });
  const connection = { id: "connection", mode } as ConnectionInstance;
  const entries = await readStatementEntries(connection, period);
  expect(getTransport).toHaveBeenCalledWith(connection);
  expect(entries).toHaveLength(2001);
  expect(entries[0]).toMatchObject({ amountMinor: -123, parentId: "split", startingBalance: false });
  expect(entries[2000].startingBalance).toBe(true);
  expect(runQuery.mock.calls[0][0].ActualQLquery).toMatchObject({ options: { splits: "inline" }, limit: 2000, offset: 0, filter: { $and: [{ date: { $gte: "2026-11-01" } }, { date: { $lte: "2026-11-06" } }] } });
  expect(runQuery.mock.calls[1][0].ActualQLquery.offset).toBe(2000);
});

it("rejects incomplete evidence and a changing paginated read rather than returning a partial statement", async () => {
  const connection = { id: "connection" } as ConnectionInstance;
  runQuery.mockResolvedValueOnce({ data: Array.from({ length: 2000 }, (_, i) => row(`row-${i}`)) }).mockRejectedValueOnce(new Error("Read failed"));
  await expect(readStatementEntries(connection, period)).rejects.toThrow("Read failed");
  runQuery.mockResolvedValueOnce({ data: [row("duplicate"), row("duplicate")] });
  await expect(readStatementEntries(connection, period)).rejects.toThrow("changed during the read");
});

it("honours cancellation before issuing a page", async () => {
  const abort = new AbortController(); abort.abort();
  await expect(readStatementEntries({ id: "connection" } as ConnectionInstance, period, abort.signal)).rejects.toThrow();
  expect(runQuery).not.toHaveBeenCalled();
});
