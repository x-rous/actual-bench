import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import { describeTimings, PostingsPanel } from "./PostingsPanel";

jest.mock("../../lib/postingsApi", () => ({ listPostings: jest.fn(async () => []), previewPostings: jest.fn(), declinePosting: jest.fn(), proposeReversal: jest.fn() }));
jest.mock("../../lib/debtsApi", () => ({ listDebtObservations: jest.fn(async () => ({ observations: [] })) }));

const detail = (openingDate: string) => ({
  debt: { id: "d1", liabilityAccountId: "acc", paymentAccountId: "chk", signConvention: "negative-is-debt", onboardingDate: null, currencyMinorDigits: 2 },
  config: { ok: true, config: { terms: { openingDate } } },
}) as unknown as DebtDetail;

describe("Proposed changes", () => {
  it("previews from the loan's start date by default", () => {
    render(<QueryClientProvider client={new QueryClient()}><PostingsPanel debt={detail("2023-10-25")} directory={undefined} /></QueryClientProvider>);
    const from = screen.getByLabelText("From") as HTMLInputElement;
    // Shown in the browser's locale date format.
    expect(from.value).toBe(new Date(Date.UTC(2023, 9, 25)).toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }));
  });

  it("describes each preview phase", () => {
    expect(describeTimings([{ phase: "payees", ms: 40 }, { phase: "planning", ms: 1500 }])).toBe("Preview took 1.5 s: payees 0.0 s, planning 1.5 s.");
  });
});
