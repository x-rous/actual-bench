import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { SimulationState } from "../../lib/simulatorModel";
import { sim } from "../../lib/simulatorTestKit";
import { CalculationMethodDrawer, CalculationMethodSummary } from "./CalculationMethodDrawer";
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

  it("names the method and its growth in the summary, and hides the contract repayment amount", () => {
    const progressive = perPeriod({ profile: { ...perPeriod().profile, amortization: "progressive-principal", recast: "never" }, progressiveGrowthDecimal: "0.0034592411" });
    render(<CalculationMethodSummary sim={progressive} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Open calculation method settings" })).toHaveTextContent("Progressive principal · +0.34592411% per repayment");
    render(<FeatureControls sim={progressive} change={() => {}} propose={() => {}} />);
    expect(screen.queryByLabelText("Contract repayment amount (optional)")).toBeNull();
  });
});
