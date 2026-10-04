"use client";

import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoHint } from "@/components/ui/info-hint";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ISO_WEEKDAYS, type BusinessDayAdjustment, type BusinessDayConvention, type IsoWeekday } from "@/lib/financial-models/calendar/businessDays";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import type { InterestAllocation } from "@/lib/financial-models/loan/statementAllocation";
import type { SimulationState } from "../../lib/simulatorModel";
import { SelectField } from "../fields";

/**
 * Due dates and lender statements (RD-084 P1.6 T281-T283). Both settings are
 * generic: which weekdays and saved dates are not business days, how a due
 * date on one of them moves, and how the lender's statements allocate
 * interest. Holidays are typed or pasted here and saved with the loan; nothing
 * is looked up online.
 */

const ADJUSTMENT_OPTIONS: { value: BusinessDayAdjustment; label: string }[] = [
  { value: "none", label: "Stays on its date" },
  { value: "following", label: "Moves to the next business day" },
  { value: "modified-following", label: "Next business day, unless that is next month" },
  { value: "preceding", label: "Moves to the previous business day" },
  { value: "modified-preceding", label: "Previous business day, unless that is last month" },
];

const ALLOCATION_OPTIONS: { value: InterestAllocation; label: string }[] = [
  { value: "as-calculated", label: "Interest up to each payment's actual date" },
  { value: "accrued-to-due-date", label: "Interest up to each due date; early-payment benefit next time" },
];

const WEEKDAY_LABELS: Record<IsoWeekday, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };

const DEFAULT_CONVENTION: Omit<BusinessDayConvention, "adjustment"> = { nonBusinessWeekdays: [6, 7], holidays: [] };

/** One date per line (or separated by commas); returns the valid dates, sorted and unique, and the lines that are not dates. */
export function parseHolidayText(text: string): { holidays: string[]; invalid: string[] } {
  const parts = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const invalid = parts.filter((s) => !isIsoDate(s));
  const holidays = [...new Set(parts.filter((s) => isIsoDate(s)))].sort();
  return { holidays, invalid };
}

export function DueDateSettings({ sim, change }: { sim: SimulationState; change: (next: SimulationState) => void }) {
  const holidaysId = useId();
  const convention = sim.businessDays ?? null;
  const adjustment = convention?.adjustment ?? "none";
  const [holidayText, setHolidayText] = useState(() => (convention?.holidays ?? []).join("\n"));
  const parsed = parseHolidayText(holidayText);

  const setConvention = (patch: Partial<BusinessDayConvention>) => {
    const base = convention ?? { adjustment: "none" as const, ...DEFAULT_CONVENTION };
    change({ ...sim, businessDays: { ...base, ...patch } });
  };
  const toggleWeekday = (day: IsoWeekday, on: boolean) => {
    const current = convention?.nonBusinessWeekdays ?? DEFAULT_CONVENTION.nonBusinessWeekdays;
    const next = on ? [...new Set([...current, day])].sort() : current.filter((d) => d !== day);
    if (next.length < 7) setConvention({ nonBusinessWeekdays: next as IsoWeekday[] });
  };

  return (
    <fieldset aria-label="Due dates and lender statements" className="flex min-w-0 flex-col gap-2 rounded-lg border p-4 lg:col-span-2">
      <legend className="px-1 text-sm font-semibold">
        <span className="inline-flex items-center gap-1.5">
          Due dates and lender statements
          <InfoHint label="due date and statement fields">
            A due date that falls on a weekend or holiday can move to a business day. Interest still accrues every calendar day. The statement setting changes only how each repayment is split between interest and principal to match your lender, not how much interest accrues.
          </InfoHint>
        </span>
      </legend>
      <SelectField
        label="A due date on a non-business day"
        value={adjustment}
        options={ADJUSTMENT_OPTIONS}
        onChange={(v) => setConvention({ adjustment: v as BusinessDayAdjustment })}
      />
      {adjustment !== "none" ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground" id={`${holidaysId}-weekdays`}>Non-business weekdays</span>
            <div role="group" aria-labelledby={`${holidaysId}-weekdays`} className="flex flex-wrap gap-3">
              {ISO_WEEKDAYS.map((day) => (
                <label key={day} className="inline-flex items-center gap-1.5 text-[13px]">
                  <Checkbox
                    checked={(convention?.nonBusinessWeekdays ?? DEFAULT_CONVENTION.nonBusinessWeekdays).includes(day)}
                    onCheckedChange={(on) => toggleWeekday(day, on)}
                  />
                  {WEEKDAY_LABELS[day]}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-medium text-muted-foreground" htmlFor={holidaysId}>Holidays</Label>
            <Textarea
              id={holidaysId}
              className="min-h-24 font-mono text-[13px]"
              placeholder={"2025-01-01\n2025-12-02"}
              value={holidayText}
              aria-invalid={parsed.invalid.length ? true : undefined}
              aria-describedby={`${holidaysId}-hint${parsed.invalid.length ? ` ${holidaysId}-issue` : ""}`}
              onChange={(e) => {
                setHolidayText(e.target.value);
                setConvention({ holidays: parseHolidayText(e.target.value).holidays });
              }}
            />
            <p id={`${holidaysId}-hint`} className="text-[11px] text-muted-foreground">
              One date per line, as YYYY-MM-DD. Saved with the loan, so past due dates stay reproducible. {parsed.holidays.length} saved.
            </p>
            {parsed.invalid.length ? (
              <p id={`${holidaysId}-issue`} className="text-[11px] font-medium text-destructive">
                Not dates, and not saved: {parsed.invalid.slice(0, 3).join(", ")}{parsed.invalid.length > 3 ? ` and ${parsed.invalid.length - 3} more` : ""}.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
      <SelectField
        label="Lender statements split repayments using"
        value={sim.lenderStatement?.interestAllocation ?? "as-calculated"}
        options={ALLOCATION_OPTIONS}
        onChange={(v) => change({ ...sim, lenderStatement: v === "as-calculated" ? null : { interestAllocation: v as InterestAllocation } })}
      />
    </fieldset>
  );
}
