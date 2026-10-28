"use client";

import { useLocalToday } from "../../lib/useLocalToday";
import { useMemo, useState } from "react";
import { BookOpen, MoreHorizontal, RotateCcw, SlidersHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { chartSeries, deltas, headline, withTracking } from "../../lib/results";
import { formatAmount } from "../../lib/money";
import type { TrackedHistory } from "../../lib/trackedSchedule";
import type { DebtProjection } from "@/lib/financial-models/loan/projection";
import { dailyEngineReason, newSimulation, switchToDayByDay, withoutExtraTransactions, type SimAssumption, type SimRate, type SimulationState } from "../../lib/simulatorModel";
import { useEventSavings } from "../../lib/useEventSavings";
import { useLiveProjection } from "../../lib/useLiveProjection";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import { labelOf, REPAYMENT_FREQUENCY_OPTIONS } from "../../lib/vocabulary";
import { LoanChartPanel } from "../chart/LoanChartPanel";
import { CalculationMethodDrawer } from "./CalculationMethodDrawer";
import { DayByDayPrompt } from "./DayByDayPrompt";
import { ExtraTransactionsDialog, type ExtraEditor } from "./ExtraTransactionsDialog";
import { EventsSection } from "./ExtraTransactionsSection";
import { FeatureControls } from "./FeatureControls";
import { HeadlineMetrics, headlineSentence } from "./HeadlineMetrics";
import { HowCalculatedDrawer } from "./HowCalculatedDrawer";
import { PrimaryInputs } from "./PrimaryInputs";
import { RateChangesDialog, type RateChangesEditor } from "./RateChangesDialog";
import { ScheduleTable } from "./ScheduleTable";
import { LoanMenuContent } from "../loan/presentation";

/**
 * The loan simulator (RD-084 P1.3b T204; FR-216–FR-229).
 *
 * A calculator, not a form: a narrow control rail (about 360 px) on the left,
 * results filling the rest (four headline figures, then a large chart), and
 * events and the schedule beneath the chart in that same results
 * column. Every change recalculates live, off the main thread, on the same
 * screen. Nothing here saves or touches Actual; the parent decides what
 * "save" means.
 */

export const NOT_ADVICE = "This is a calculation from the settings entered, not financial advice.";

const comparableSimulation = (value: SimulationState) => JSON.stringify(value, (key, item) => key === "key" || key === "id" ? undefined : item);

export type SimulatorViewProps = {
  sim: SimulationState;
  onChange: (next: SimulationState) => void;
  /** The saved simulation, for "Compare with saved" (existing loans only). */
  saved?: SimulationState | null;
  title: string;
  badge: string;
  stepLabel?: string;
  readOnly?: boolean;
  revision: number | null;
  actions: React.ReactNode;
  /** Inside the loan workspace (Calculation tab): the workspace header carries the name, state and Save. */
  embedded?: boolean;
  /**
   * The loan workspace shows these controls in its own top bar (rev 4): no toolbar row here, and
   * Compare, the two drawers and Reset are driven from outside.
   */
  external?: {
    comparing: boolean;
    dialog: "method" | "how" | null;
    onDialogChange: (dialog: "method" | "how" | null) => void;
    resetOpen: boolean;
    onResetOpenChange: (open: boolean) => void;
  };
  /** A loan tracked in Actual (design spec 06 §7.6): the history from the Loan Ledger and where the projection starts. */
  tracked?: (TrackedHistory & { onOpenLedger: () => void }) | null;
  /** Where the chart's Monthly/Yearly choice is remembered in this browser (a saved loan); absent: not remembered. */
  chartViewKey?: string;
  offsetTracking?: {
    asOfDate: string;
    onAsOfDateChange: (date: string) => void;
    snapshots: OffsetHistorySnapshot[] | undefined;
    loading: boolean;
    problems: string[];
  };
};

function readChartView(key: string | undefined): "month" | "year" | null {
  if (!key) return null;
  try { const v = localStorage.getItem(key); return v === "month" || v === "year" ? v : null; } catch { return null; }
}
function writeChartView(key: string | undefined, view: "month" | "year"): void {
  if (!key) return;
  try { localStorage.setItem(key, view); } catch { /* storage unavailable: the choice lasts for this visit */ }
}

/** A tracked loan's calculation: the contract before the tracking start, what really happened, then the projection from today. */
function composeTracked(projection: DebtProjection | null, contract: DebtProjection | null, tracked: TrackedHistory | null): DebtProjection | null {
  if (!tracked) return projection;
  if (!projection?.ok || !contract?.ok) return null;
  return {
    ...projection,
    events: [...contract.events.filter((e) => e.date < tracked.startDate), ...tracked.events, ...projection.events.filter((e) => e.date > tracked.anchor.date)],
    offsetStates: [...contract.offsetStates.filter((o) => o.date < tracked.startDate), ...projection.offsetStates],
  };
}

export function SimulatorView({ sim, onChange, saved = null, title, badge, stepLabel, readOnly = false, revision, actions, offsetTracking, embedded = false, external, tracked = null, chartViewKey }: SimulatorViewProps) {
  const [comparingLocal, setComparing] = useState(false);
  const comparing = external ? external.comparing : comparingLocal;
  const [prompt, setPrompt] = useState<{ reason: string; candidate: SimulationState } | null>(null);
  const [dialogLocal, setDialogLocal] = useState<"method" | "how" | null>(null);
  const dialog = external ? external.dialog : dialogLocal;
  const setDialog = external ? external.onDialogChange : setDialogLocal;
  const [rateEditor, setRateEditor] = useState<RateChangesEditor | null>(null);
  const [extraEditor, setExtraEditor] = useState<ExtraEditor | null>(null);
  const [resetOpenLocal, setResetOpenLocal] = useState(false);
  const resetOpen = external ? external.resetOpen : resetOpenLocal;
  const setResetOpen = external ? external.onResetOpenChange : setResetOpenLocal;
  // Monthly for loans up to 10 years; yearly for longer ones, where monthly points get too dense to read. A choice is
  // remembered per loan in this browser.
  const [chosenView, setChosenView] = useState<"month" | "year" | null>(() => readChartView(chartViewKey));
  const chartView = chosenView ?? ((sim.termMonths ?? Infinity) <= 120 ? "month" : "year");
  const setChartView = (view: "month" | "year") => { setChosenView(view); writeChartView(chartViewKey, view); };
  const unsaved = saved !== null && JSON.stringify(saved) !== JSON.stringify(sim);
  const noExtras = useMemo(() => withoutExtraTransactions(sim), [sim]);
  const hasExtras = noExtras !== sim;
  const needsActualOffsetHistory = sim.offsets.some((offset) => offset.useActualBalance);
  const offsetProblems = offsetTracking?.problems ?? (needsActualOffsetHistory ? ["Save the Actual-linked offset mapping before calculating with its history."] : undefined);
  const trackedAt = useMemo(() => (tracked ? { startDate: tracked.startDate, anchor: tracked.anchor } : null), [tracked]);
  // A tracked loan always runs its projection without what-ifs too: the What-ifs impact and the From Actual impact need it.
  const live = useLiveProjection(sim, { compareWith: comparing && saved ? saved : null, impactBaseline: hasExtras || tracked ? noExtras : null, offsetHistories: offsetTracking?.snapshots, suspend: offsetTracking?.loading, externalProblems: offsetProblems, tracked: trackedAt });

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

  const projection = useMemo(() => composeTracked(live.projection, live.contract, tracked), [live.projection, live.contract, tracked]);
  const baseProjection = useMemo(() => composeTracked(live.impactBaseline, live.contract, tracked), [live.impactBaseline, live.contract, tracked]);
  const events = projection?.ok ? projection.events : null;
  const head = useMemo(() => (events ? headline(events) : null), [events]);
  const compared = useMemo(() => (live.comparison?.ok ? headline(live.comparison.events) : null), [live.comparison]);
  const impactBaseline = useMemo(() => (baseProjection?.ok ? headline(baseProjection.events) : null), [baseProjection]);
  const contractHead = useMemo(() => (live.contract?.ok ? headline(live.contract.events) : null), [live.contract]);
  // What each event saves runs on the projections as calculated (not joined to the history), so every step of a chain
  // is measured the same way.
  const rawHead = useMemo(() => (live.projection?.ok ? headline(live.projection.events) : null), [live.projection]);
  const rawBase = useMemo(() => (live.impactBaseline?.ok ? headline(live.impactBaseline.events) : null), [live.impactBaseline]);
  const savingsTracked = useMemo(() => (tracked ? { startDate: tracked.startDate, anchor: tracked.anchor, ledgerEvents: tracked.ledgerEvents } : null), [tracked]);
  const savings = useEventSavings(sim, { baseline: rawBase, current: rawHead, contract: contractHead, ready: live.status === "ok", tracked: savingsTracked, histories: offsetTracking?.snapshots });
  const delta = head && compared ? deltas(head, compared) : null;
  const frequency = labelOf(REPAYMENT_FREQUENCY_OPTIONS, sim.profile.repaymentFrequency).toLowerCase();
  const chart = useMemo(() => {
    if (!projection?.ok) return null;
    const data = chartSeries(projection, sim, { view: chartView, comparison: live.comparison });
    return tracked ? withTracking(data, tracked, chartView) : data;
  }, [projection, live.comparison, sim, chartView, tracked]);
  const calendarTodayForDetails = tracked?.today ?? null;
  const details = useMemo(() => {
    if (!events || !head) return undefined;
    const today = calendarTodayForDetails ?? new Date().toISOString().slice(0, 10);
    const paid = events.filter((e) => e.date <= today).reduce((sum, e) => sum + e.interestMinor, 0);
    const months = head.payoffDate ? Math.max(0, Math.round((Date.parse(`${head.payoffDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (86_400_000 * 30.4375))) : null;
    const left = months === null ? null : months === 0 ? "Paid off" : `${Math.floor(months / 12) ? `${Math.floor(months / 12)} yrs ` : ""}${months % 12 ? `${months % 12} mos ` : ""}left`.trim();
    return { interest: `Paid so far ${formatAmount(paid, sim.minorDigits)} · still to pay ${formatAmount(head.totalInterestMinor - paid, sim.minorDigits)}`, payoff: left };
  }, [events, head, calendarTodayForDetails, sim.minorDigits]);
  const calendarToday = useLocalToday();
  const resetValue = useMemo(() => newSimulation({ currency: sim.currency, minorDigits: sim.minorDigits, today: calendarToday }), [sim.currency, sim.minorDigits, calendarToday]);
  const resetMeaningful = comparableSimulation(sim) !== comparableSimulation(resetValue);
  const removeExtra = (assumption: SimAssumption) => propose({ ...sim, assumptions: sim.assumptions.filter((candidate) => candidate.key !== assumption.key) });
  const removeRate = (rate: SimRate) => propose({ ...sim, rates: sim.rates.filter((candidate) => candidate.key !== rate.key) });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {external ? null : <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        {embedded ? (
          <h2 className="mr-2 text-sm font-semibold">{title}</h2>
        ) : (
          <>
            <h1 className="mr-2 text-base font-semibold">{title}</h1>
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", unsaved ? "border-primary font-medium" : "border-border text-muted-foreground")} role="status">
              {badge}
            </span>
          </>
        )}
        {stepLabel ? <span className="text-xs font-medium text-muted-foreground">{stepLabel}</span> : null}
        {saved ? (
          <label className="flex items-center gap-1 text-xs">
            <Checkbox checked={comparing} onCheckedChange={setComparing} />
            Compare with saved
          </label>
        ) : null}
        <Button type="button" variant="link" size="sm" className="h-auto gap-1 px-1 text-xs" onClick={() => setDialog("how")}>
          <BookOpen aria-hidden="true" />
          How this loan is calculated
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setDialog("method")}>
            <SlidersHorizontal aria-hidden="true" />
            Set calculation method
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="More schedule actions" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "px-2")}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger>
            <LoanMenuContent>
              <DropdownMenuItem variant="destructive" disabled={readOnly} onClick={() => (resetMeaningful ? setResetOpen(true) : change(resetValue))}>
                <RotateCcw aria-hidden="true" />
                Reset loan
              </DropdownMenuItem>
            </LoanMenuContent>
          </DropdownMenu>
          {actions}
        </div>
      </header>}

      <div className="flex flex-1 flex-col lg:flex-row lg:items-stretch">
        {/* The inputs fill their column edge to edge (no rounding), with the same padding on every side. */}
        <aside aria-label="Loan inputs" className="flex w-full shrink-0 flex-col gap-3 bg-muted/40 p-4 lg:w-[396px]" data-testid="control-rail">
          <PrimaryInputs sim={sim} change={change} onCalculationMethod={() => setDialog("method")} onRateChanges={() => setRateEditor("list")} />
          <FeatureControls sim={sim} change={change} propose={propose} />
        </aside>

        <main aria-label="Results" className="flex min-w-0 flex-1 flex-col divide-y divide-border border-l border-border" data-testid="results-region">
          {offsetTracking ? (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
              <label htmlFor="offset-observation-cutoff" className="font-medium">Actual offset history through</label>
              <DateInput id="offset-observation-cutoff" value={offsetTracking.asOfDate} onValueChange={offsetTracking.onAsOfDateChange} className="h-7 w-40 text-xs" />
              <span className="text-muted-foreground">Observed balances are authoritative through this inclusive date; simulated events resume afterward.</span>
            </div>
          ) : null}
          <HeadlineMetrics
            headline={head}
            deltas={delta}
            digits={sim.minorDigits}
            frequencyLabel={frequency}
            calculating={live.status === "calculating"}
            announce={live.status === "ok" && head ? headlineSentence(head, sim.minorDigits, frequency) : null}
            details={details}
          />
          {live.status === "incomplete" ? <p className="px-4 py-3 text-sm text-muted-foreground">Enter the {live.missing.join(", ")} to see the loan.</p> : null}
          {live.status === "calculating" && !events ? <p className="px-4 py-3 text-sm text-muted-foreground">Calculating…</p> : null}
          {(live.status === "blocked" || live.status === "error") && live.problems.length ? (
            <div role="alert" className="bg-destructive/5 px-4 py-3 text-sm">
              <p className="font-medium">This loan cannot be calculated yet.</p>
              <ul className="list-disc pl-5 text-xs">
                {live.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {chart && chart.points.length ? <div className="px-4 py-3"><LoanChartPanel data={chart} view={chartView} onViewChange={setChartView} digits={sim.minorDigits} /></div> : null}
          {events ? (
            <>
              <EventsSection sim={sim} current={head} baseline={impactBaseline} savings={savings} onEdit={setExtraEditor} onRemove={removeExtra} onEditRate={setRateEditor} onRemoveRate={removeRate}
                tracked={tracked ? {
                  startDate: tracked.startDate, today: tracked.today, ledgerEvents: tracked.ledgerEvents,
                  fromActual: [savings.fromActualAfter, contractHead], whatIfs: [head, impactBaseline],
                  onToggle: (a) => change({ ...sim, assumptions: sim.assumptions.map((x) => (x.key === a.key ? { ...x, enabled: x.enabled === false } : x)) }),
                  onOpenLedger: tracked.onOpenLedger,
                } : undefined} />
              <div data-testid="schedule-region" className="pt-3">
                <ScheduleTable events={events} profile={sim.profile} startDate={sim.startDate} digits={sim.minorDigits} today={calendarToday} tracked={tracked ? { startDate: tracked.startDate, today: tracked.today, missingDueDates: tracked.missingDueDates } : null} />
              </div>
            </>
          ) : null}
          <p className="px-4 py-2 text-[11px] text-muted-foreground" data-testid="not-advice">
            {NOT_ADVICE}
          </p>
        </main>
      </div>

      <DayByDayPrompt
        reason={prompt?.reason ?? null}
        onCancel={() => setPrompt(null)}
        onSwitch={() => {
          if (prompt) change(switchToDayByDay(prompt.candidate));
          setPrompt(null);
        }}
      />
      {rateEditor !== null ? <RateChangesDialog onClose={() => setRateEditor(null)} sim={sim} propose={propose} initialEditor={rateEditor} /> : null}
      <ExtraTransactionsDialog open={extraEditor !== null} onClose={() => setExtraEditor(null)} sim={sim} propose={propose} editor={extraEditor} />
      <CalculationMethodDrawer open={dialog === "method"} onClose={() => setDialog(null)} sim={sim} change={change} />
      <HowCalculatedDrawer open={dialog === "how"} onClose={() => setDialog(null)} sim={sim} projection={live.projection} revision={revision} unsaved={unsaved} />
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        state={{ title: "Reset this loan?", message: "This discards the current simulation inputs and restores the sample loan.", destructiveLabel: "Reset loan", onConfirm: () => change(resetValue) }}
      />
    </div>
  );
}

/** The Schedule controls as the loan workspace shows them in its top bar (rev 4). */
export function ScheduleControls({ comparing, onComparingChange, onDialog }: { comparing?: boolean; /** Absent for a loan with nothing saved to compare with. */ onComparingChange?: (on: boolean) => void; onDialog: (dialog: "method" | "how") => void }) {
  return (
    <>
      {onComparingChange ? (
        <label className="flex items-center gap-1 text-xs">
          <Checkbox checked={!!comparing} onCheckedChange={(on) => onComparingChange(on === true)} />
          Compare with saved
        </label>
      ) : null}
      <Button type="button" variant="link" size="sm" className="h-auto gap-1 px-1 text-xs" onClick={() => onDialog("how")}>
        <BookOpen aria-hidden="true" />
        How this loan is calculated
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => onDialog("method")}>
        <SlidersHorizontal aria-hidden="true" />
        Set calculation method
      </Button>
    </>
  );
}
