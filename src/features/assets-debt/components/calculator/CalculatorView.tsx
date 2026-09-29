"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { AssumptionInput } from "@/lib/app-db/debtAssumptionRepository";
import type { FutureAssumption } from "@/lib/financial-models/loan/model";
import type { DebtProjection, DebtProjectionEvent, DebtProjectionOverrides } from "@/lib/financial-models/loan/projection";
import { getSchedule, saveAssumptions } from "../../lib/debtsApi";
import { formatMinor, parseMajorToMinor, percentToFraction } from "../../lib/money";
import { DateField, TextField } from "../editor/fields";
import { SaveBoundaryNotice } from "../editor/EditorFooter";
import { BalanceChart } from "./BalanceChart";

/**
 * Calculator and forecast (RD-084 P1.3; FR-105–FR-110, FR-204, FR-205).
 *
 * Alternatives are temporary: they are sent with each projection and never
 * stored (FR-113). Only "Apply as baseline" persists, and it writes nothing
 * but the debt's baseline assumptions and a new revision. A projection never
 * creates a transaction in Actual.
 */

export const NOT_ADVICE = "This is a calculation from the settings you entered, not financial advice.";

const addYears = (iso: string, years: number) => `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;

type Alternative = { extraAmount: string; extraDate: string; extraMonthlyUntil: string; ratePercent: string; rateFrom: string };
const EMPTY: Alternative = { extraAmount: "", extraDate: "", extraMonthlyUntil: "", ratePercent: "", rateFrom: "" };

function buildOverrides(alt: Alternative, digits: number): { ok: true; overrides: DebtProjectionOverrides | null } | { ok: false; message: string } {
  const overrides: DebtProjectionOverrides = {};
  const amount = parseMajorToMinor(alt.extraAmount, digits);
  if (!amount.ok) return { ok: false, message: amount.message };
  if (amount.value !== null) {
    if (!alt.extraDate) return { ok: false, message: "Choose the date of the extra repayment" };
    overrides.assumptions = [
      alt.extraMonthlyUntil
        ? { kind: "extra-repayment", date: alt.extraDate, amountMinor: amount.value, recurrence: { frequency: "monthly", until: alt.extraMonthlyUntil } }
        : { kind: "extra-repayment", date: alt.extraDate, amountMinor: amount.value },
    ];
  }
  const rate = percentToFraction(alt.ratePercent);
  if (!rate.ok) return { ok: false, message: rate.message };
  if (rate.value !== null) {
    if (!alt.rateFrom) return { ok: false, message: "Choose when the alternative rate starts" };
    overrides.rates = [{ accrualEffectiveFrom: alt.rateFrom, annualRateDecimal: rate.value }];
  }
  return { ok: true, overrides: overrides.assumptions || overrides.rates ? overrides : null };
}

function totals(p: DebtProjection | undefined) {
  if (!p?.ok) return null;
  const interest = p.events.reduce((s, e) => s + e.interestMinor, 0);
  const closing = p.events.at(-1)?.balanceAfterMinor ?? 0;
  const payoff = p.events.find((e) => e.balanceAfterMinor === 0)?.date ?? null;
  return { interest, closing, payoff };
}

function ScheduleTable({ events, digits, currency }: { events: DebtProjectionEvent[]; digits: number; currency: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual; the compiler skips this component, which is what it needs.
  const v = useVirtualizer({ count: events.length, getScrollElement: () => ref.current, estimateSize: () => 28, overscan: 10, initialRect: { width: 800, height: 400 } });
  const cells = "grid grid-cols-[7rem_9rem_1fr_1fr_1fr] gap-2 px-2 text-xs tabular-nums";
  return (
    <div role="table" aria-label="Schedule" aria-rowcount={events.length + 1} className="flex min-h-0 flex-col rounded border border-border">
      <div role="row" aria-rowindex={1} className={`${cells} border-b border-border py-1 font-medium`}>
        <span role="columnheader">Date</span>
        <span role="columnheader">Event</span>
        <span role="columnheader">Paid</span>
        <span role="columnheader">Interest</span>
        <span role="columnheader">Balance after</span>
      </div>
      <div ref={ref} className="max-h-96 overflow-auto">
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((item) => {
            const e = events[item.index];
            return (
              <div key={item.key} role="row" aria-rowindex={item.index + 2} className={`${cells} absolute left-0 right-0 items-center`} style={{ height: 28, transform: `translateY(${item.start}px)` }}>
                <span role="cell">{e.date}</span>
                <span role="cell">{e.eventType}</span>
                <span role="cell">{e.cashMovementMinor < 0 ? formatMinor(-e.cashMovementMinor, digits, currency) : ""}</span>
                <span role="cell">{e.interestMinor ? formatMinor(e.interestMinor, digits, currency) : ""}</span>
                <span role="cell">{formatMinor(e.balanceAfterMinor, digits, currency)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CalculatorView({ detail }: { detail: DebtDetail }) {
  const queryClient = useQueryClient();
  const digits = detail.debt.currencyMinorDigits;
  const currency = detail.debt.currency;
  const opening = detail.config.ok ? detail.config.config.terms.openingDate : "2000-01-01";
  const [from, setFrom] = useState(opening);
  const [to, setTo] = useState(addYears(opening, 30));
  const [draft, setDraft] = useState<Alternative>(EMPTY);
  const [applied, setApplied] = useState<Alternative>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const built = useMemo(() => buildOverrides(applied, digits), [applied, digits]);
  const overrides = built.ok ? built.overrides : null;
  const key = ["assets-debt", "schedule", detail.debt.id, detail.debt.currentRevision, from, to];
  const baseline = useQuery({ queryKey: key, queryFn: () => getSchedule(detail.debt.id, { from, to, resolution: "monthly" }), enabled: !detail.blocked && !!from && !!to });
  const alternative = useQuery({
    queryKey: [...key, overrides],
    queryFn: () => getSchedule(detail.debt.id, { from, to, resolution: "monthly", overrides: overrides! }),
    enabled: !detail.blocked && !!overrides,
  });

  const apply = useMutation({
    mutationFn: () => {
      const extras = (overrides?.assumptions ?? []).filter((x): x is Extract<FutureAssumption, { kind: "extra-repayment" }> => x.kind === "extra-repayment");
      const existing = detail.assumptions.map((a) => ({
        id: a.id,
        kind: a.assumptionKind as AssumptionInput["kind"],
        effectiveFrom: a.effectiveFrom,
        recurrence: a.recurrence && !("unknown" in a.recurrence) ? a.recurrence : null,
        amountMinor: a.amountMinor ?? 0,
        feeTreatment: (a.feeTreatment as "cash-paid" | "capitalized" | null) ?? null,
        offsetAccountId: a.offsetAccountId,
        note: a.note,
      }));
      const added = extras.map((x) => ({ kind: "extra-repayment" as const, effectiveFrom: x.date, recurrence: x.recurrence ?? null, amountMinor: x.amountMinor, feeTreatment: null, offsetAccountId: null, note: "From the calculator" }));
      return saveAssumptions(detail.debt.id, [...existing, ...added], "Calculator result applied as baseline");
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["assets-debt"] });
      toast.success(`Baseline updated (revision ${saved.debt.currentRevision})`);
      setDraft(EMPTY);
      setApplied(EMPTY);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not apply the baseline"),
  });

  if (detail.blocked) return <p className="px-4 py-3 text-sm" role="status">Blocked: {detail.blocked.message}</p>;

  const base = totals(baseline.data);
  const alt = totals(alternative.data);
  const blockedMessage = (p: DebtProjection | undefined) => (p && !p.ok ? p.blocked.map((b) => b.message).join(" ") : null);

  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      <p className="text-xs font-medium" data-testid="not-advice">{NOT_ADVICE}</p>
      <section aria-labelledby="calc-window" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <h2 id="calc-window" className="sr-only">Forecast window</h2>
        <DateField label="Forecast from" value={from} onChange={setFrom} />
        <DateField label="Forecast to" value={to} onChange={setTo} />
      </section>

      <form
        aria-labelledby="calc-alt"
        className="flex flex-col gap-3 rounded border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const check = buildOverrides(draft, digits);
          if (!check.ok) {
            setProblem(check.message);
            return;
          }
          setProblem(null);
          setApplied(draft);
        }}
      >
        <h2 id="calc-alt" className="text-sm font-semibold">Try an alternative</h2>
        <p className="text-[11px] text-muted-foreground">Nothing here is saved unless you apply it as the baseline.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <TextField label="Extra repayment" value={draft.extraAmount} onChange={(v) => setDraft((d) => ({ ...d, extraAmount: v }))} inputMode="decimal" />
          <DateField label="Extra repayment date" value={draft.extraDate} onChange={(v) => setDraft((d) => ({ ...d, extraDate: v }))} />
          <DateField label="Repeat monthly until" value={draft.extraMonthlyUntil} onChange={(v) => setDraft((d) => ({ ...d, extraMonthlyUntil: v }))} hint="Blank for a one-off payment." />
          <TextField label="Alternative rate (%)" value={draft.ratePercent} onChange={(v) => setDraft((d) => ({ ...d, ratePercent: v }))} inputMode="decimal" />
          <DateField label="Alternative rate from" value={draft.rateFrom} onChange={(v) => setDraft((d) => ({ ...d, rateFrom: v }))} />
        </div>
        {problem ? (
          <p role="alert" className="text-xs text-destructive">
            {problem}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm">Calculate</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); setProblem(null); }}>
            Clear
          </Button>
        </div>
      </form>

      <section aria-labelledby="calc-result" aria-live="polite" className="flex flex-col gap-3">
        <h2 id="calc-result" className="text-sm font-semibold">Forecast</h2>
        {baseline.isLoading ? <p className="text-xs text-muted-foreground">Calculating…</p> : null}
        {baseline.isError ? <p role="alert" className="text-xs text-destructive">{(baseline.error as Error).message}</p> : null}
        {blockedMessage(baseline.data) ? <p role="alert" className="text-xs text-destructive">The forecast is blocked: {blockedMessage(baseline.data)}</p> : null}
        {base ? (
          <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Interest in the window</dt>
              <dd className="tabular-nums">{formatMinor(base.interest, digits, currency)}{alt ? ` (alternative: ${formatMinor(alt.interest, digits, currency)})` : ""}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Paid off</dt>
              <dd>{base.payoff ?? "Not within the window"}{alt ? ` (alternative: ${alt.payoff ?? "not within the window"})` : ""}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Balance at the end</dt>
              <dd className="tabular-nums">{formatMinor(base.closing, digits, currency)}{alt ? ` (alternative: ${formatMinor(alt.closing, digits, currency)})` : ""}</dd>
            </div>
          </dl>
        ) : null}
        {baseline.data?.ok ? <BalanceChart baseline={baseline.data.monthly} alternative={alternative.data?.ok ? alternative.data.monthly : null} digits={digits} currency={currency} /> : null}
        {baseline.data?.ok ? <ScheduleTable events={(alternative.data?.ok ? alternative.data : baseline.data).events} digits={digits} currency={currency} /> : null}
      </section>

      {overrides?.assumptions ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-3">
          <SaveBoundaryNotice />
          <Button
            type="button"
            size="sm"
            disabled={apply.isPending}
            onClick={() =>
              setConfirm({
                title: "Apply as baseline?",
                message: "The extra repayment becomes part of this debt's baseline assumptions and a new revision is recorded. No transaction is created in Actual.",
                destructive: false,
                destructiveLabel: "Apply",
                onConfirm: () => apply.mutate(),
              })
            }
          >
            Apply as baseline
          </Button>
        </div>
      ) : null}
      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)} state={confirm} />
    </div>
  );
}
