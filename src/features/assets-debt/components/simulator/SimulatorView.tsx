"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { chartSeries, deltas, headline } from "../../lib/results";
import { dailyEngineReason, endRecurringExtrasBefore, minorDigitsFor, switchToDayByDay, type SimulationState } from "../../lib/simulatorModel";
import { useLiveProjection } from "../../lib/useLiveProjection";
import { labelOf, REPAYMENT_FREQUENCY_OPTIONS } from "../../lib/vocabulary";
import { LoanChartPanel } from "../chart/LoanChartPanel";
import { CalculationMethodDrawer, CalculationMethodSummary } from "./CalculationMethodDrawer";
import { DayByDayPrompt } from "./DayByDayPrompt";
import { describeAssumption, ExtraTransactionsDialog } from "./ExtraTransactionsDialog";
import { FeatureControls } from "./FeatureControls";
import { HeadlineMetrics, headlineSentence } from "./HeadlineMetrics";
import { HowCalculatedDrawer } from "./HowCalculatedDrawer";
import { PrimaryInputs } from "./PrimaryInputs";
import { RateChangesDialog } from "./RateChangesDialog";
import { ScheduleTable } from "./ScheduleTable";

/**
 * The loan simulator (RD-084 P1.3b T204; FR-216–FR-229).
 *
 * A calculator, not a form: a narrow control rail (about 360 px) on the left,
 * results filling the rest (four headline figures, then a large chart), and
 * the schedule directly beneath at full width. Every change recalculates
 * live, off the main thread, on the same screen. Nothing here saves or touches
 * Actual; the parent decides what "save" means.
 */

export const NOT_ADVICE = "This is a calculation from the settings entered, not financial advice.";

const CURRENCIES = ["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "NZD", "SGD", "USD", "ZAR"];

export type SimulatorViewProps = {
  sim: SimulationState;
  onChange: (next: SimulationState) => void;
  /** The saved simulation, for "Compare with saved" (existing loans only). */
  saved?: SimulationState | null;
  title: string;
  badge: string;
  readOnly?: boolean;
  revision: number | null;
  actions: React.ReactNode;
};

export function SimulatorView({ sim, onChange, saved = null, title, badge, readOnly = false, revision, actions }: SimulatorViewProps) {
  const [comparing, setComparing] = useState(false);
  const [prompt, setPrompt] = useState<{ reason: string; candidate: SimulationState } | null>(null);
  const [dialog, setDialog] = useState<"rates" | "extras" | "method" | "how" | null>(null);
  const [chartView, setChartView] = useState<"month" | "year">("year");
  const unsaved = saved !== null && JSON.stringify(saved) !== JSON.stringify(sim);
  const live = useLiveProjection(sim, { compareWith: comparing && saved ? saved : null });

  const change = (next: SimulationState) => {
    if (!readOnly) onChange(next);
  };
  /** O1: features the period-by-period calculation cannot represent ask before switching. */
  const propose = (candidate: SimulationState) => {
    if (readOnly) return;
    const reason = dailyEngineReason(candidate);
    if (reason) setPrompt({ reason, candidate });
    else onChange(candidate);
  };

  const events = live.projection?.ok ? live.projection.events : null;
  const head = useMemo(() => (events ? headline(events) : null), [events]);
  const compared = useMemo(() => (live.comparison?.ok ? headline(live.comparison.events) : null), [live.comparison]);
  const delta = head && compared ? deltas(head, compared) : null;
  const frequency = labelOf(REPAYMENT_FREQUENCY_OPTIONS, sim.profile.repaymentFrequency).toLowerCase();
  const chart = useMemo(() => (live.projection?.ok ? chartSeries(live.projection, sim, { view: chartView, comparison: live.comparison }) : null), [live.projection, live.comparison, sim, chartView]);
  const overpay = live.blocked.find((b) => b.code === "credit-balance" && b.date);
  const extras = sim.assumptions.filter((a) => !(a.kind === "offset-balance" && a.effectiveFrom <= sim.startDate));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="mr-2 text-base font-semibold">{title}</h1>
        <label className="sr-only" htmlFor="sim-shape">
          Loan shape
        </label>
        <Select
          id="sim-shape"
          size="sm"
          aria-label="Loan shape"
          value={sim.shape}
          disabled={readOnly}
          onValueChange={(v) => change({ ...sim, shape: v as SimulationState["shape"] })}
          options={[
            { value: "term-loan", label: "Term loan" },
            { value: "revolving-credit", label: "Line of credit" },
          ]}
        />
        <Select
          size="sm"
          aria-label="Currency"
          value={sim.currency}
          disabled={readOnly}
          onValueChange={(v) => change({ ...sim, currency: v, minorDigits: minorDigitsFor(v) })}
          options={[...new Set([sim.currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))}
        />
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", unsaved ? "border-primary font-medium" : "border-border text-muted-foreground")} role="status">
          {badge}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {saved ? (
            <label className="flex items-center gap-1 text-xs">
              <Checkbox checked={comparing} onCheckedChange={setComparing} />
              Compare with saved
            </label>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setDialog("how")}>
            How this loan is calculated
          </Button>
          {actions}
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start">
        <aside aria-label="Loan inputs" className="flex w-full shrink-0 flex-col gap-4 lg:w-[360px]" data-testid="control-rail">
          <PrimaryInputs sim={sim} change={change} onRateChanges={() => setDialog("rates")} />
          <FeatureControls sim={sim} change={change} propose={propose} />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Extra transactions</span>
            {extras.length ? (
              <ul className="text-xs">
                {extras.slice(0, 3).map((a) => (
                  <li key={a.key}>{describeAssumption(a, sim.currency, sim.minorDigits)}</li>
                ))}
                {extras.length > 3 ? <li>and {extras.length - 3} more</li> : null}
              </ul>
            ) : (
              <span className="text-xs text-muted-foreground">None</span>
            )}
            <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={() => setDialog("extras")}>
              {extras.length ? `Edit extra transactions (${extras.length})` : "Add extra transactions"}
            </Button>
          </div>
          <CalculationMethodSummary sim={sim} onOpen={() => setDialog("method")} />
        </aside>

        <main aria-label="Results" className="flex min-w-0 flex-1 flex-col gap-4" data-testid="results-region">
          <HeadlineMetrics
            headline={head}
            deltas={delta}
            currency={sim.currency}
            digits={sim.minorDigits}
            frequencyLabel={frequency}
            calculating={live.status === "calculating"}
            announce={live.status === "ok" && head ? headlineSentence(head, sim.currency, sim.minorDigits, frequency) : null}
          />
          {live.status === "incomplete" ? <p className="text-sm text-muted-foreground">Enter the {live.missing.join(", ")} to see the loan.</p> : null}
          {live.status === "calculating" && !events ? <p className="text-sm text-muted-foreground">Calculating…</p> : null}
          {(live.status === "blocked" || live.status === "error") && live.problems.length ? (
            <div role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm">
              <p className="font-medium">This loan cannot be calculated yet.</p>
              <ul className="list-disc pl-5 text-xs">
                {live.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {overpay?.date && sim.assumptions.some((a) => a.kind === "extra-repayment" && a.recurrence) ? (
                <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => change(endRecurringExtrasBefore(sim, overpay.date!))}>
                  End extra repayments at payoff
                </Button>
              ) : null}
            </div>
          ) : null}
          {chart && chart.points.length ? <LoanChartPanel data={chart} view={chartView} onViewChange={setChartView} currency={sim.currency} digits={sim.minorDigits} /> : null}
          <p className="text-[11px] text-muted-foreground" data-testid="not-advice">
            {NOT_ADVICE}
          </p>
        </main>
      </div>

      {events ? (
        <div className="px-4 pb-6" data-testid="schedule-region">
          <ScheduleTable events={events} profile={sim.profile} currency={sim.currency} digits={sim.minorDigits} />
        </div>
      ) : null}

      <DayByDayPrompt
        reason={prompt?.reason ?? null}
        onCancel={() => setPrompt(null)}
        onSwitch={() => {
          if (prompt) onChange(switchToDayByDay(prompt.candidate));
          setPrompt(null);
        }}
      />
      <RateChangesDialog open={dialog === "rates"} onClose={() => setDialog(null)} sim={sim} propose={propose} />
      <ExtraTransactionsDialog open={dialog === "extras"} onClose={() => setDialog(null)} sim={sim} propose={propose} />
      <CalculationMethodDrawer open={dialog === "method"} onClose={() => setDialog(null)} sim={sim} change={change} />
      <HowCalculatedDrawer open={dialog === "how"} onClose={() => setDialog(null)} sim={sim} projection={live.projection} revision={revision} unsaved={unsaved} />
    </div>
  );
}
