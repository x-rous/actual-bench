import { fireEvent, render, screen, within } from "@testing-library/react";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { testAsset, testRow } from "@/lib/asset-registry/testing";
import type { ActionContext } from "@/lib/asset-registry/actions";
import { executeDepreciation } from "@/lib/asset-registry/depreciationActions";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import { DepreciationPanel } from "./DepreciationPanel";
import { registryRequest } from "./api";
jest.mock("./api", () => ({ registryRequest: jest.fn() }));
jest.mock("@/lib/asset-registry/depreciationActions", () => ({ ...jest.requireActual("@/lib/asset-registry/depreciationActions"), executeDepreciation: jest.fn() }));

const TODAY = "2026-03-15";
const source = [testRow("opening", 1200000, { date: "2025-12-01" })];
const asset = testAsset("asset", { assetTag: null });
const registry = { assets: [asset], metadata: [], depreciation: [{ assetId: "asset", method: "straight-line" as const, basisMinor: 1200000, residualMinor: 0, startDate: "2026-01-01", lifeMonths: 12, annualRateBps: null, updatedAt: "t" }] };
const transport = { getSyncCapabilities: () => ({ capabilities: { createTransaction: true, createTransactionWithImportedId: true } }) } as unknown as ActualBenchTransport;
const snapshot = (date: string) => ({ accountId: "vehicles", date, source, rows: normalizeActivity(source).rows, balanceMinor: 1200000, issues: [], fetchedAt: "t", transferKnown: true });
const fresh = async (date: string): Promise<ActionContext> => ({ transport, registry, asset, snapshot: snapshot(date) });
const renderPanel = (onSaved = jest.fn(async () => {})) => render(<DepreciationPanel asset={asset} registry={registry} snapshot={snapshot(TODAY)} valueMinor={1200000} today={TODAY} fresh={fresh} onSaved={onSaved} onEdit={jest.fn()} onOpenBook={jest.fn()} financialBlocked={false} onUncertain={jest.fn()} />);
beforeEach(() => jest.clearAllMocks());
const select = (name: string) => fireEvent.click(screen.getByRole("checkbox", { name: `Select depreciation ${name}` }));
it("shows only ended months as due, previews each at its own month end and posts them one at a time", async () => {
  jest.mocked(executeDepreciation).mockResolvedValueOnce({ transactionId: "jan", noop: false, deleted: false }).mockResolvedValueOnce({ transactionId: "feb", noop: false, deleted: false });
  jest.mocked(registryRequest).mockResolvedValue(registry);
  renderPanel();
  expect(screen.getByRole("checkbox", { name: "Select depreciation 2026-03" })).toBeDisabled(); // unfinished month stays a forecast
  select("2026-01"); select("2026-02");
  fireEvent.click(screen.getByRole("button", { name: "Post selected (2)" }));
  const list = await screen.findByRole("list", { name: "Depreciation postings" });
  expect(within(list).getByText(/Jan 2026 · 31 Jan/)).toBeInTheDocument(); expect(within(list).getByText(/Feb 2026 · 28 Feb/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Confirm Actual write" }));
  await screen.findByText("Posted 28 Feb");
  expect(executeDepreciation).toHaveBeenCalledTimes(2);
  expect(jest.mocked(registryRequest).mock.calls.map((c) => (c[2] as { changes: { depreciationPeriod?: string }[] }).changes[0].depreciationPeriod)).toEqual(["2026-01", "2026-02"]);
});
it("stops after a failed month and retries only the association after a metadata failure", async () => {
  jest.mocked(executeDepreciation).mockResolvedValue({ transactionId: "jan", noop: false, deleted: false });
  jest.mocked(registryRequest).mockRejectedValueOnce(new Error("Metadata unavailable")).mockResolvedValue(registry);
  renderPanel();
  select("2026-01"); select("2026-02");
  fireEvent.click(screen.getByRole("button", { name: "Post selected (2)" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Actual write" }));
  await screen.findByText("Metadata unavailable"); expect(screen.getByText("Not attempted")).toBeInTheDocument();
  expect(executeDepreciation).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry association only" }));
  await screen.findByText("Posted 31 Jan");
  expect(executeDepreciation).toHaveBeenCalledTimes(1); expect(registryRequest).toHaveBeenCalledTimes(2);
});
it("summarises the schedule: what is posted, what is left, the next charge and when it ends", () => {
  renderPanel();
  const strip = screen.getByLabelText("Depreciation summary");
  const tile = (name: string) => within(strip).getByText(name).parentElement!;
  expect(tile("Depreciation posted")).toHaveTextContent("0.00"); expect(tile("Depreciation posted")).toHaveTextContent("0 of 12 months");
  expect(tile("Remaining to depreciate")).toHaveTextContent("12,000.00");
  expect(tile("Next monthly charge")).toHaveTextContent("1,000.00"); expect(tile("Next monthly charge")).toHaveTextContent("Jan 2026 · due now");
  expect(tile("Fully depreciated by")).toHaveTextContent("31 Dec");
  expect(within(strip).queryByText("Residual value")).not.toBeInTheDocument();
});
