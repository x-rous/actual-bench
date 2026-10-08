import { splitOperationReads, withinDates, type RawTxn, type StructurePrimitives } from "./transactionStructure";

const date = "2026-06-01";
const watch = { accountIds: ["checking"], sinceDate: date, untilDate: date };

function setup() {
  let rows: RawTxn[] = [{ id: "before" }];
  const readAccount = jest.fn(async () => rows);
  const settledAccountSnapshot = jest.fn(() => rows);
  const primitives: StructurePrimitives = {
    readAccount, settledAccountSnapshot,
    update: jest.fn(async () => { rows = [{ id: "after-update" }]; }),
    remove: jest.fn(async () => { rows = []; }),
  };
  return { primitives, readAccount, settledAccountSnapshot };
}

describe("operation-scoped split reads", () => {
  it("starts with fresh preflight and shares only identical ranges within a phase", async () => {
    const { primitives, readAccount, settledAccountSnapshot } = setup();
    const session = withinDates(splitOperationReads(primitives), [date]);
    await session.readAccount("checking", date);
    await session.readAccount("checking", date);
    await session.readAccount("loan", date);
    await session.readAccount("checking", "2026-05-01");
    expect(readAccount.mock.calls).toEqual([["checking", date, date], ["loan", date, date], ["checking", "2026-05-01", date]]);
    expect(settledAccountSnapshot).not.toHaveBeenCalled();
  });

  it("invalidates every write and uses complete settled read-back, including an empty account", async () => {
    const { primitives, readAccount } = setup();
    const session = splitOperationReads(primitives);
    expect(await session.readAccount("checking", date, date)).toEqual([{ id: "before" }]);
    await session.update("parent", {}, watch);
    expect(await session.readAccount("checking", date, date)).toEqual([{ id: "after-update" }]);
    await session.remove("child", watch);
    expect(await session.readAccount("checking", date, date)).toEqual([]);
    expect(readAccount).toHaveBeenCalledTimes(1);
    // A new repayment must start with a fresh read even if a settled snapshot exists.
    await splitOperationReads(primitives).readAccount("checking", date, date);
    expect(readAccount).toHaveBeenCalledTimes(2);
  });

  it("falls back to fresh reads when the transport has no matching snapshot", async () => {
    const { primitives, readAccount } = setup();
    primitives.settledAccountSnapshot = () => undefined;
    const session = splitOperationReads(primitives);
    await session.readAccount("checking", date, date);
    await session.update("parent", {}, watch);
    expect(await session.readAccount("checking", date, date)).toEqual([{ id: "after-update" }]);
    expect(readAccount).toHaveBeenCalledTimes(2);
  });

  it("discards cached and settled evidence after a failed write", async () => {
    const { primitives, readAccount, settledAccountSnapshot } = setup();
    primitives.update = jest.fn(async () => { throw new Error("write interrupted"); });
    const session = splitOperationReads(primitives);
    await session.readAccount("checking", date, date);
    await expect(session.update("parent", {}, watch)).rejects.toThrow("interrupted");
    await session.readAccount("checking", date, date);
    expect(readAccount).toHaveBeenCalledTimes(2);
    expect(settledAccountSnapshot).not.toHaveBeenCalled();
  });
});
