import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { progressiveFirstPrincipal } from "@/lib/financial-models/loan/repayment";
import { dec, fromMinor, toMinor } from "@/lib/financial-models/money/kernel";
import type { SimulationState } from "../../lib/simulatorModel";
import { offsetOf, sim } from "../../lib/simulatorTestKit";
import { CalculationMethodDrawer, CalculationMethodSummary } from "./CalculationMethodDrawer";
import { EventsSection } from "./ExtraTransactionsSection";
import { FeatureControls } from "./FeatureControls";

/** A per-period loan; the default recalculates the repayment when the rate changes. */
const perPeriod = (patch: Partial<SimulationState> = {}) => {
  const s = sim();
  return { ...s, profile: { ...s.profile, accrual: "per-period" as const, chargeFrequency: "at-repayment" as const, chargeDay: null, capitalization: "at-charge" as const }, ...patch };
};

function Harness({ initial, onChange }: { initial: SimulationState; onChange: (s: SimulationState) => void }) {
  const [state, setState] = useState(initial);
  return <CalculationMethodDrawer open onClose={() => {}} sim={state} change={(next) => { setState(next); onChange(next); }} />;
}

async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const item = await screen.findByRole("option", { name: option });
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.pointerUp(item, { pointerType: "mouse" });
  fireEvent.mouseUp(item, { button: 0 });
  fireEvent.click(item);
}

describe("progressive principal in Set calculation method", () => {
  it("asks before clearing settings that don't apply, and Cancel leaves everything as it was", async () => {
    const onChange = jest.fn();
    render(<Harness initial={perPeriod()} onChange={onChange} />);
    await choose("Amortization", "Progressive principal plus interest");
    const dialog = await screen.findByRole("dialog", { name: "Switch to progressive principal?" });
    expect(dialog).toHaveTextContent("Recalculate the repayment: When the rate changes becomes Never");
    expect(dialog).toHaveTextContent("Nothing is saved until you save the loan");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Switch to progressive principal?" })).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears a rate change's cap and turns off repayment changes only when the switch is confirmed", async () => {
    const base = perPeriod();
    const capped = { ...base.rates[0], key: "r2", accrualEffectiveFrom: "2028-01-01", annualRateDecimal: "0.05", paymentRecalcPolicy: "on-rate-change" as const, paymentCap: { kind: "previous-payment-factor" as const, factor: "1.075" } };
    const change = { key: "pc", kind: "payment-change" as const, effectiveFrom: "2029-01-01", recurrence: null, amountMinor: 3_000_00, feeTreatment: null, offsetAccountId: null, note: null };
    const initial = perPeriod({ rates: [base.rates[0], capped], assumptions: [change] });
    const onChange = jest.fn();
    render(<Harness initial={initial} onChange={onChange} />);
    await choose("Amortization", "Progressive principal plus interest");
    const dialog = await screen.findByRole("dialog", { name: "Switch to progressive principal?" });
    expect(dialog).toHaveTextContent("A rate change's repayment recalculation and caps are removed");
    expect(dialog).toHaveTextContent("A repayment change in your what-ifs is turned off");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Switch to progressive principal?" })).toBeNull());
    expect(onChange).not.toHaveBeenCalled();

    await choose("Amortization", "Progressive principal plus interest");
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Switch to progressive principal?" })).getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.lastCall[0] as SimulationState;
    expect(next.rates[1]).toMatchObject({ key: "r2", annualRateDecimal: "0.05", paymentRecalcPolicy: null, paymentCap: null });
    expect(next.assumptions[0]).toMatchObject({ key: "pc", enabled: false });
  });

  it("switches, shows only what applies, and restores the recast rule when switching back", async () => {
    const onChange = jest.fn();
    render(<Harness initial={perPeriod()} onChange={onChange} />);
    await choose("Amortization", "Progressive principal plus interest");
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Switch to progressive principal?" })).getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile: expect.objectContaining({ amortization: "progressive-principal", recast: "never", repaymentDerivation: "annuity-at-payment-frequency" }) })));

    expect(screen.getByLabelText("Principal growth per repayment")).toBeInTheDocument();
    expect(screen.getByText(/Worked out from the principal growth/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Repayment amount" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "A repayment counts" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Transactions on the same day as interest" })).toBeNull();
    expect(screen.queryByRole("switch", { name: /negative amortization/ })).toBeNull();
    expect(screen.getByText(/a payment between due dates lowers the balance on its own date and the interest from the next period/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Recalculate the repayment" }));
    expect(await screen.findByRole("option", { name: "Once a year (not with progressive principal)" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await choose("Amortization", "Level payment");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile: expect.objectContaining({ amortization: "level-payment", recast: "on-rate-change" }) })));
  });

  it("offers per-period interest on a daily-interest loan, ticked by default, and restores daily interest when switching back", async () => {
    const onChange = jest.fn();
    render(<Harness initial={sim()} onChange={onChange} />);
    await choose("Amortization", "Progressive principal plus interest");
    const dialog = await screen.findByRole("dialog", { name: "Switch to progressive principal?" });
    const box = within(dialog).getByRole("checkbox", { name: "Also charge interest per payment period" });
    expect(box).toBeChecked();
    expect(dialog).toHaveTextContent("so repayments go up and down");
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile: expect.objectContaining({ amortization: "progressive-principal", accrual: "per-period", capitalization: "at-charge" }) })));

    await choose("Amortization", "Level payment");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile: expect.objectContaining({ amortization: "level-payment", accrual: "daily-simple", recast: "on-rate-change" }) })));
  });

  it("keeps daily interest when the per-period box is unticked", async () => {
    const onChange = jest.fn();
    render(<Harness initial={sim()} onChange={onChange} />);
    await choose("Amortization", "Progressive principal plus interest");
    const dialog = await screen.findByRole("dialog", { name: "Switch to progressive principal?" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Also charge interest per payment period" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile: expect.objectContaining({ amortization: "progressive-principal", accrual: "daily-simple" }) })));
  });

  it("asks on a daily-interest loan even when no other setting changes", async () => {
    const onChange = jest.fn();
    const s = sim();
    render(<Harness initial={{ ...s, profile: { ...s.profile, recast: "never" } }} onChange={onChange} />);
    await choose("Amortization", "Progressive principal plus interest");
    const dialog = await screen.findByRole("dialog", { name: "Switch to progressive principal?" });
    expect(dialog).not.toHaveTextContent("so these settings change");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["an offset", () => sim(offsetOf(10_000_00)), "An offset changes the interest day by day"],
    ["business-day due dates", () => sim({ businessDays: { adjustment: "following", nonBusinessWeekdays: [6, 7], holidays: [] } }), "Business-day due dates need daily interest"],
  ])("keeps daily interest, and says why, on a loan with %s", async (_, make, reason) => {
    const onChange = jest.fn();
    render(<Harness initial={make()} onChange={onChange} />);
    await choose("Amortization", "Progressive principal plus interest");
    const dialog = await screen.findByRole("dialog", { name: "Switch to progressive principal?" });
    const box = within(dialog).getByRole("checkbox", { name: "Also charge interest per payment period" });
    expect(box).not.toBeChecked();
    expect(box).toBeDisabled();
    expect(dialog).toHaveTextContent(`Not available for this loan: ${reason}`);
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile: expect.objectContaining({ amortization: "progressive-principal", accrual: "daily-simple" }) })));
  });

  it("never offers per-period interest on a loan that already has it", async () => {
    render(<Harness initial={perPeriod()} onChange={() => {}} />);
    await choose("Amortization", "Progressive principal plus interest");
    const dialog = await screen.findByRole("dialog", { name: "Switch to progressive principal?" });
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
  });

  it("works the growth out from one row of the lender's table and stages it", async () => {
    const onChange = jest.fn();
    render(<Harness initial={perPeriod({ profile: { ...perPeriod().profile, amortization: "progressive-principal", recast: "never" }, principalMinor: 203_353_10, termMonths: 276 })} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Work it out/ }));
    fireEvent.change(await screen.findByLabelText("Principal it repays"), { target: { value: "441.38" } });
    expect(await screen.findByRole("status")).toHaveTextContent("Growth 0.34592411% per repayment");
    expect(screen.getByRole("status")).toHaveTextContent("Matches the loan as set up: instalment 1 repays 441.38");
    fireEvent.click(screen.getByRole("button", { name: "Use this growth" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ progressiveGrowthDecimal: "0.0034592411" })));
  });

  it("checks the worked-out growth against the loan's own schedule, interest-only months included", async () => {
    // Two interest-only months first: instalment 3 is the first to repay principal, from the full balance over 274.
    const s = perPeriod({
      profile: { ...perPeriod().profile, amortization: "progressive-principal", recast: "never" }, principalMinor: 203_353_10, termMonths: 276,
      startDate: "2026-09-30", firstPaymentDate: "2026-10-30", rates: [{ ...sim().rates[0], annualRateDecimal: "0.036", accrualEffectiveFrom: "2026-09-30" }],
      interestOnly: true, phases: [{ kind: "interest-only", from: "2026-09-30", to: "2026-11-30", recastAtEnd: "never" }] as SimulationState["phases"],
    });
    const row3 = toMinor(progressiveFirstPrincipal(fromMinor(203_353_10, 2), dec("0.0034592411"), 274), 2, "half-up");
    render(<Harness initial={s} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Work it out/ }));
    fireEvent.change(await screen.findByLabelText("Principal it repays"), { target: { value: (row3 / 100).toFixed(2) } });
    fireEvent.change(screen.getByLabelText("Instalments left, including it"), { target: { value: "274" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(`Matches the loan as set up: instalment 3 repays ${(row3 / 100).toFixed(2)}`));
  });

  it("names the method and its growth in the summary, and hides the contract repayment amount", () => {
    const progressive = perPeriod({ profile: { ...perPeriod().profile, amortization: "progressive-principal", recast: "never" }, progressiveGrowthDecimal: "0.0034592411" });
    render(<CalculationMethodSummary sim={progressive} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Open calculation method settings" })).toHaveTextContent("Progressive principal · +0.34592411% per repayment");
    render(<FeatureControls sim={progressive} change={() => {}} propose={() => {}} />);
    expect(screen.queryByLabelText("Contract repayment amount (optional)")).toBeNull();
  });

  it("never lets a tracked what-if switch turn a repayment change back on for a progressive loan", () => {
    const change = { key: "pc", kind: "payment-change" as const, effectiveFrom: "2030-01-30", recurrence: null, amountMinor: 1_200_00, feeTreatment: null, offsetAccountId: null, note: null, enabled: false };
    const extra = { ...change, key: "x", kind: "extra-repayment" as const, amountMinor: 5_000_00 };
    const progressive = perPeriod({ profile: { ...perPeriod().profile, amortization: "progressive-principal", recast: "never" }, progressiveGrowthDecimal: "0.0034592411", assumptions: [change, extra] });
    const onToggle = jest.fn();
    render(<EventsSection sim={progressive} current={null} baseline={null} onEdit={() => {}} onRemove={() => {}} onEditRate={() => {}} onRemoveRate={() => {}}
      tracked={{ startDate: "2026-10-30", today: "2026-11-10", ledgerEvents: [], fromActual: [null, null], whatIfs: [null, null], onToggle, onOpenLedger: () => {} }} />);
    const locked = screen.getByRole("switch", { name: /^Include Repayment change on 2030-01-30 in the projection$/ });
    expect(locked).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(locked);
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: /^Include Extra payment on 2030-01-30 in the projection$/ })).not.toHaveAttribute("aria-disabled", "true");
  });
});
