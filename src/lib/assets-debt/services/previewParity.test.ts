import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { actualRowsToPreviewRows, renderPreviewRows, type PreviewDirectory, type PreviewRow } from "@/features/assets-debt/components/preview/renderPreviewRows";
import { HARNESS_MODES } from "../testing/transportHarness";
import { ACCOUNTS, LENDER, byKind, createScenario, type Scenario } from "../testing/postingScenario";
import type { PostingView } from "./proposalService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/**
 * SC-019: for every supported write shape (create, restructure, link) the rows
 * the preview showed equal the rows Actual holds after apply, read back
 * through Bench's real transport, in both modes. The same assertion runs live
 * in patterns.live.test.ts.
 */

function directoryOf(s: Scenario): PreviewDirectory {
  return {
    accounts: s.directory.accounts,
    categories: s.directory.categories,
    payeeNames: { [LENDER]: "Home Lender" },
    transferAccountByPayee: Object.fromEntries(Object.entries(s.transferPayees).map(([account, payee]) => [payee, account])),
  };
}

async function readBack(s: Scenario, posting: PostingView, shown: PreviewRow[], applied: PostingView) {
  const read = [
    ...(await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.checking, startDate: "2024-01-01" })),
    ...(await s.transport.listTransactionsForSync({ accountId: ACCOUNTS.mortgage, startDate: "2024-01-01" })),
  ];
  const ids = applied.actualIds ?? [];
  const output = posting.output;
  return actualRowsToPreviewRows(shown, read, directoryOf(s), 2, (row, index) => {
    if (output.kind === "create") return read.find((r) => r.importedId === output.operations[index].importedId)?.id ?? null;
    if (output.kind === "link") return index === 0 ? output.sourceBefore.id : output.counterpartBefore.id;
    if (output.kind === "restructure") {
      const children = output.expectedPostState.children.length;
      if (index === 0) return ids[0];
      if (index <= children) return ids[index];
      return ids[children + 1 + (index - children - 1)] ?? null;
    }
    return row.key;
  });
}

describe.each(HARNESS_MODES)("preview parity (%s)", (mode) => {
  it("create: the previewed interest charge is exactly the row Actual holds", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const [charge] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    const shown = renderPreviewRows(charge.output, directoryOf(s), 2);
    const { posting } = await s.apply(charge);
    expect(await readBack(s, charge, shown, posting)).toEqual(shown);
  });

  it("restructure: parent, children and the Actual-created counterpart match the preview", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    const shown = renderPreviewRows(split.output, directoryOf(s), 2);
    expect(shown.map((r) => r.splitParent)).toEqual([true, false, false, false]);
    const { posting } = await s.apply(split);
    expect(await readBack(s, split, shown, posting)).toEqual(shown);
  });

  it("link: the source child and the linked lender row match the preview, imported fields unchanged", async () => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest", lenderFeed: true });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    if (split.output.kind !== "restructure") throw new Error("restructure");
    s.seedLenderRow("2024-02-01", -split.output.expectedPostState.children[0].amountMinor);
    await s.apply(split);
    const [link] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-link");
    const shown = renderPreviewRows(link.output, directoryOf(s), 2);
    expect(shown[1]).toMatchObject({ linkedChip: true, rowKind: "linked" });
    const { posting } = await s.apply(link);
    expect(await readBack(s, link, shown, posting)).toEqual(shown);
  });
});
