import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import * as api from "../../lib/debtsApi";
import { LenderReconciliation, verdictOf } from "./LenderReconciliation";

jest.mock("../../lib/debtsApi", () => ({ listDebtObservations: jest.fn(), getDebtReconciliation: jest.fn(), recordDebtObservation: jest.fn(), createDebtAnchor: jest.fn(), runConventionDiagnostic: jest.fn(), acceptDebtDrift: jest.fn() }));
jest.mock("@/store/connection", () => ({ useConnectionStore: (select: (s: unknown) => unknown) => select({}), selectActiveInstance: () => ({ id: "c1", budgetSyncId: "b1" }) }));
jest.mock("@/lib/assets-debt/actual/ledgerPort", () => ({ ...jest.requireActual("@/lib/assets-debt/actual/ledgerPort"), readDatedBalance: jest.fn(async () => ({ ok: true, balanceMinor: -10_487_947 })) }));
jest.mock("@/lib/actual", () => ({ getTransport: () => ({}) }));

describe("lender statement verdicts (T308)", () => {
  const base = { lenderMinor: 10_487_947, toleranceMinor: 100, digits: 2 };
  it("says which side is off, in words", () => {
    expect(verdictOf({ ...base, actualMinor: 10_487_947, calculatedMinor: 10_487_947 }).text).toBe("Actual and the calculation agree with the lender.");
    expect(verdictOf({ ...base, actualMinor: 10_487_947, calculatedMinor: 10_523_611 })).toMatchObject({ text: "Actual agrees with the lender; the calculation is off by 356.64.", calcOff: true, actualOff: false });
    expect(verdictOf({ ...base, actualMinor: 10_400_000, calculatedMinor: 10_487_947 })).toMatchObject({ text: "The calculation agrees with the lender; Actual is off by 879.47.", calcOff: false, actualOff: true });
    expect(verdictOf({ ...base, actualMinor: 1, calculatedMinor: 2 }).text).toBe("Neither Actual nor the calculation matches the lender.");
    expect(verdictOf({ ...base, actualMinor: 10_488_000, calculatedMinor: 10_487_900 }).calcOff).toBe(false);
  });
});

describe("the lender statements drawer (T308)", () => {
  it("shows the latest statement against Actual and the calculation, the actions that fit, and every statement", async () => {
    jest.mocked(api.listDebtObservations).mockResolvedValue({ observations: [{ id: "o1", debtId: "d1", observedOn: "2026-10-01", recordedAt: "t", principalMinor: 10_487_947, accruedInterestMinor: null, source: "manual", supersedesObservationId: null, note: null, createdAt: "t" }], history: [] } as never);
    jest.mocked(api.getDebtReconciliation).mockResolvedValue({ comparison: { modelMinor: 10_523_611 }, drift: "material" } as never);
    const debt = { debt: { id: "d1", liabilityAccountId: "loan", signConvention: "negative-is-debt", currencyMinorDigits: 2, driftToleranceMinor: 100 }, offsets: [] } as never;
    render(<QueryClientProvider client={new QueryClient()}><LenderReconciliation debt={debt} /></QueryClientProvider>);
    const latest = await screen.findByRole("region", { name: "Latest statement" });
    await waitFor(() => expect(within(latest).getByRole("status")).toHaveTextContent("Actual agrees with the lender; the calculation is off by 356.64."));
    expect(latest).toHaveTextContent("✓ matches the lender");
    expect(latest).toHaveTextContent("356.64 above the lender");
    expect(within(latest).getByRole("button", { name: "Find which calculation method matches" })).toBeInTheDocument();
    expect(within(latest).getByRole("button", { name: "Restart the calculation from here" })).toBeInTheDocument();
    expect(within(latest).getByRole("button", { name: "Accept this difference" })).toBeInTheDocument();
    expect(within(latest).getByRole("button", { name: "+ Add a statement" })).toBeInTheDocument();
    const all = screen.getByRole("region", { name: "All statements" });
    expect(within(all).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Date", "Lender", "Actual then", "Calculated then", "Actions"]);
    expect(within(all).getByRole("button", { name: /Actions for the statement of/ })).toBeInTheDocument();
  });
});
