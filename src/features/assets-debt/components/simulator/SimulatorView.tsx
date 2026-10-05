"use client";

import { useMemo, useState } from "react";
import { BookOpen, MoreHorizontal, RotateCcw, SlidersHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { chartSeries, deltas, headline } from "../../lib/results";
import { dailyEngineReason, newSimulation, switchToDayByDay, withoutExtraTransactions, type SimAssumption, type SimRate, type SimulationState } from "../../lib/simulatorModel";
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
  offsetTracking?: {
    asOfDate: string;
    onAsOfDateChange: (date: string) => void;
    snapshots: OffsetHistorySnapshot[] | undefined;
    loading: boolean;
    problems: string[];
  };
};

export function SimulatorView({ sim, onChange, saved = null, title, badge, stepLabel, readOnly = false, revision, actions, offsetTracking, embedded = false, external }: SimulatorViewProps) {
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
  const [chartView, setChartView] = useState<"month" | "year">("year");
  const unsaved = saved !== null && JSON.stringify(saved) !== JSON.stringify(sim);
  const noExtras = useMemo(() => withoutExtraTransactions(sim), [sim]);
  const hasExtras = noExtras !== sim;
  const needsActualOffsetHistory = sim.offsets.some((offset) => offset.useActualBalance);
  const offsetProblems = offsetTracking?.problems ?? (needsActualOffsetHistory ? ["Save the Actual-linked offset mapping before calculating with its history."] : undefined);
  const live = useLiveProjection(sim, { compareWith: comparing && saved ? saved : null, impactBaseline: hasExtras ? noExtras : null, offsetHistories: offsetTracking?.snapshots, suspend: offsetTracking?.loading, externalProblems: offsetProblems });

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
  const impactBaseline = useMemo(() => (live.impactBaseline?.ok ? headline(live.impactBaseline.events) : null), [live.impactBaseline]);
  const delta = head && compared ? deltas(head, compared) : null;
  const frequency = labelOf(REPAYMENT_FREQUENCY_OPTIONS, sim.profile.repaymentFrequency).toLowerCase();
  const chart = useMemo(() => (live.projection?.ok ? chartSeries(live.projection, sim, { view: chartView, comparison: live.comparison }) : null), [live.projection, live.comparison, sim, chartView]);
  const resetValue = useMemo(() => newSimulation({ currency: sim.currency, minorDigits: sim.minorDigits, today: new Date().toISOString().slice(0, 10) }), [sim.currency, sim.minorDigits]);
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
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" disabled={readOnly} onClick={() => (resetMeaningful ? setResetOpen(true) : change(resetValue))}>
                <RotateCcw aria-hidden="true" />
                Reset loan
              </DropdownMenuItem>
            </DropdownMenuContent>
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

        <main aria-label="Results" className="flex min-w-0 flex-1 flex-col gap-4 p-4" data-testid="results-region">
          {offsetTracking ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
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
            </div>
          ) : null}
          {chart && chart.points.length ? <LoanChartPanel data={chart} view={chartView} onViewChange={setChartView} digits={sim.minorDigits} /> : null}
          {events ? (
            <>
              <EventsSection sim={sim} current={head} baseline={impactBaseline} onEdit={setExtraEditor} onRemove={removeExtra} onEditRate={setRateEditor} onRemoveRate={removeRate} />
              <div data-testid="schedule-region">
                <ScheduleTable events={events} profile={sim.profile} startDate={sim.startDate} digits={sim.minorDigits} />
              </div>
            </>
          ) : null}
          <p className="text-[11px] text-muted-foreground" data-testid="not-advice">
            {NOT_ADVICE}
          </p>
        </main>
      </div>

      <DayByDayPrompt
        reason={prompt?.reason ?? null}
        onCancel={() => setPrompt(null)}
        onSwitch={() => {
          if (prompt) onChange(switchToDayByDay(prompt.candidate));
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

