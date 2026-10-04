import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import * as api from "../../lib/postingsApi";
import { ActivityTimeline } from "./ActivityTimeline";

jest.mock("../../lib/postingsApi", () => ({ listPostings: jest.fn(), reproducePosting: jest.fn() }));
const mocked = api as jest.Mocked<typeof api>;

/** T138: the posting timeline and reproduction view (accessible; no automation run history). */
describe("ActivityTimeline", () => {
  // jsdom has no layout; give the virtualized list a height, as the Rules tab tests do.
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  beforeAll(() => Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 360 }));
  afterAll(() => {
    if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
  });

  it("lists proposals, decisions, applies and reversals, and shows stored vs recomputed on Reproduce", async () => {
    const base = { budgetSyncId: "b", subjectKind: "debt", subjectId: "d", generation: 1, configRevision: 1, inputFormatVersion: 1, inputHash: "h", engineVersions: {}, classification: "safe", reasons: [], idempotencyMarker: null, actualIds: ["txn-1"], error: null, createdAt: "t", updatedAt: "t", output: { kind: "create" } };
    mocked.listPostings.mockResolvedValue([
      { ...base, id: "p1", postingKind: "interest-charge", periodKey: "2024-02-28", status: "applied", decidedAt: "2024-06-02T00:00:00Z", appliedAt: "2024-06-02T00:00:01Z", reversalOf: null },
      { ...base, id: "p2", postingKind: "interest-charge", periodKey: "2024-03-28", status: "declined", decidedAt: "2024-06-03T00:00:00Z", appliedAt: null, reversalOf: null },
    ] as never);
    mocked.reproducePosting.mockResolvedValue({ postingId: "p1", status: "exact-match", stored: [{ kind: "interest", amountMinor: 387857 }], recomputed: [{ kind: "interest", amountMinor: 387857 }], detail: "Recomputed from stored inputs at the recorded engine versions.", continuity: "first" });
    render(<QueryClientProvider client={new QueryClient()}><ActivityTimeline debtId="d" currencyMinorDigits={2} /></QueryClientProvider>);
    const list = await screen.findByRole("list", { name: "Posting activity, 2 entries" });
    expect(list).toBeInTheDocument();
    expect(screen.getByText("Declined 2024-06-03")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reproduce" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Stored interest 3,878.57 · Recomputed interest 3,878.57 · Exact match");
    expect(screen.queryByText(/automation/i)).toBeNull();
  });
});
