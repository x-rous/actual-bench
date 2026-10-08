import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { buildChangeRows } from "./changeRows";
import { bulkSteps } from "./bulkApply";
import { canPrepareReversal, prepareBulkReversal } from "./bulkReversal";

const posting = (id: string, periodKey: string, recorded = true) => ({
  id, periodKey, status: "applied", reversalOf: null, createdAt: "2026-10-08", postingKind: "repayment-split",
  output: recorded ? { kind: "claim", rows: [], recordedSplit: { parent: { date: periodKey, amountMinor: -10000 }, children: [] } }
    : { kind: "restructure", before: { date: periodKey, amountMinor: -10000 } },
}) as unknown as PostingView;

describe("bulk reversal preparation", () => {
  it("selects applied rows without treating them as Apply proposals, and restricts Unsplit to recorded splits", () => {
    const rows = buildChangeRows([posting("existing", "2026-01-01"), posting("bench", "2026-02-01", false)]);
    expect(rows.every((row) => row.selectable === "reverse")).toBe(true);
    expect(bulkSteps(rows)).toEqual([]);
    expect(rows.every((row) => canPrepareReversal(row, "undo"))).toBe(true);
    expect(rows.filter((row) => canPrepareReversal(row, "unsplit")).map((row) => row.key)).toEqual(["existing"]);
  });

  it.each(["undo", "unsplit"] as const)("prepares %s newest first, stops on refusal, and retains earlier success", async (action) => {
    const rows = buildChangeRows([posting("jan", "2026-01-01"), posting("feb", "2026-02-01"), posting("mar", "2026-03-01")]);
    const propose = jest.fn(async (p: PostingView) => {
      if (p.id === "feb") throw new Error("Transaction already claimed");
      return p;
    });
    const result = await prepareBulkReversal(rows, action, propose);
    expect(propose.mock.calls.map(([p]) => p.id)).toEqual(["mar", "feb"]);
    expect(result.prepared.map((row) => row.key)).toEqual(["mar"]);
    expect(result.stopped).toMatchObject({ row: { key: "feb" }, reason: "Transaction already claimed" });
    expect(result.remaining).toBe(1);
  });

  it("refuses a mixed or ineligible selection before creating any proposals", async () => {
    const rows = buildChangeRows([posting("existing", "2026-01-01"), posting("bench", "2026-02-01", false)]);
    const propose = jest.fn();
    await expect(prepareBulkReversal(rows, "unsplit", propose)).rejects.toThrow("eligible");
    expect(propose).not.toHaveBeenCalled();
  });

  it("allows a confirmed unwritten failed reversal to be prepared again, but keeps uncertain failures unselectable", () => {
    const original = posting("existing", "2026-01-01");
    const reversal = { ...original, id: "failed", postingKind: "reversal", reversalOf: original.id, status: "failed", error: { written: false } } as PostingView;
    const retry = buildChangeRows([original, reversal])[0];
    expect(canPrepareReversal(retry, "unsplit")).toBe(true);
    expect(bulkSteps([retry])).toEqual([]);
    for (const error of [{ written: true }, {}]) {
      expect(buildChangeRows([original, { ...reversal, error } as PostingView])[0].selectable).toBeNull();
    }
    expect(buildChangeRows([original, { ...reversal, status: "indeterminate" } as PostingView])[0].selectable).toBeNull();
  });
});
