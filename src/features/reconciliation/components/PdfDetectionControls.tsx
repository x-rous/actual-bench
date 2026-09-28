"use client";

import { useEffect } from "react";
import { BookOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PdfPanelField, PdfPanelSection } from "./PdfPanelSection";
import type {
  PdfAccountType,
  PdfDateFormatOption,
  PdfImportDate,
  PdfNumberFormat,
  PdfParserGuidance,
  PdfPrintedSign,
} from "@/lib/reconciliation/statement/pdf";
import { accountTypeLabel } from "../lib/pdfReviewTable";
import { MAX_PAGE_RULE } from "@/lib/reconciliation/statement/pdf";
import { DateInput } from "@/components/ui/date-input";

/** The density this panel is read at, matching the panels beside it. */
const DENSE = "h-7 text-xs";
import { cn } from "@/lib/utils";

const DATE_FORMATS: { value: PdfDateFormatOption; label: string }[] = [
  { value: "auto", label: "Auto-detect from mapped dates" },
  { value: "dmy", label: "Day / month / year" },
  { value: "mdy", label: "Month / day / year" },
  { value: "ymd", label: "Year / month / day" },
  { value: "dmy-name", label: "Month-name date (03 Jul or Jul 03)" },
  { value: "iso", label: "ISO year-month-day" },
  { value: "ymd-compact", label: "Compact YYYYMMDD" },
];

const NUMBER_FORMATS: { value: PdfNumberFormat; label: string }[] = [
  { value: "auto", label: "Auto-detect from printed values" },
  { value: "us", label: "1,234.56" },
  { value: "european", label: "1.234,56" },
  { value: "space", label: "1 234,56" },
  { value: "indian", label: "1,23,456.78" },
  { value: "swiss", label: "1'234.56" },
];

const PRINTED_SIGNS: { value: PdfPrintedSign; label: string }[] = [
  { value: "auto", label: "Detect from the account type" },
  { value: "account-holder", label: "Minus is money out (bank account)" },
  { value: "issuer", label: "Minus is money in (card or loan issuer)" },
];

const ACCOUNT_TYPES: PdfAccountType[] = [
  "checking",
  "savings",
  "credit-card",
  "prepaid",
  "multi-currency",
  "business-cash",
  "loan",
  "investment",
];

/**
 * How the statement is being read, for when the automatic answer is wrong.
 *
 * A disclosure rather than a `<details>`: the summary states the current
 * reading, so it is the one line most readers need, and a real button gives it
 * a focus ring and an expanded state that a `<summary>` does not carry here.
 */
export function PdfDetectionControls({
  guidance,
  accountType,
  detectedDirection,
  attentionIds = [],
  focusRequest,
  open,
  disabled,
  onOpenChange,
  onChange,
}: {
  guidance: PdfParserGuidance;
  accountType: PdfAccountType;
  /** What automatic detection found for amount direction, in words. */
  detectedDirection: string;
  /**
   * Controls rows are waiting on, from the "What needs attention" list. They
   * are marked here and named there, never explained in two places.
   */
  attentionIds?: string[];
  focusRequest: { id: string; requestId: number } | null;
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<PdfParserGuidance>) => void;
}) {
  // A question raised elsewhere is answered here: the caller opens this
  // section, and the caret lands on the control that settles the question.
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      const control = document.getElementById(focusRequest.id);
      if (!(control instanceof HTMLElement)) return;
      // Not every environment implements scrolling; focus is the part that matters.
      if (typeof control.scrollIntoView === "function") control.scrollIntoView({ block: "center", behavior: "smooth" });
      control.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  const needs = (id: string) => attentionIds.includes(id);
  const importDateLabel = guidance.importDate === "transaction"
    ? "Transaction date"
    : guidance.importDate === "posting" ? "Posting date" : "Value date";

  return (
    <PdfPanelSection
      title="Statement Interpretation"
      open={open}
      onOpenChange={onOpenChange}
      attention={attentionIds.length > 0}
      action={
        <a
          href={HOW_STATEMENTS_ARE_READ}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="How statements are read (opens the guide in a new tab)"
          title="How statements are read"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BookOpen aria-hidden="true" className="size-3.5" />
        </a>
      }
      summary={`${accountTypeLabel(accountType)} · ${guidance.currency ?? "currency automatic"} · import ${importDateLabel.toLowerCase()}`}
    >
      {/*
        No sentence introducing the controls: the section is named, and the
        line under its name already says how this statement is being read.
        Three columns where there is room, because a setting is one short row.
      */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        <PdfPanelField label="Account type" htmlFor="pdf-account-type"
          hint="Decides which way the balance moves for money in and out: a card balance rises when you spend, a bank balance falls. Saved with the layout.">
          <Select
            id="pdf-account-type"
            size="sm"
            className={cn(needs("pdf-account-type") && QUESTION_FIELD)}
            value={guidance.accountType}
            disabled={disabled}
            onValueChange={(value) => onChange({ accountType: value as PdfParserGuidance["accountType"] })}
            options={[
              { value: "auto", label: `Auto-detect (${accountTypeLabel(accountType)})` },
              ...ACCOUNT_TYPES.map((value) => ({ value, label: accountTypeLabel(value) })),
            ]}
          />
        </PdfPanelField>
        <PdfPanelField label="Statement currency" htmlFor="pdf-statement-currency"
          hint="The currency of the account amounts. Amounts in other currencies are read as original amounts. Saved with the layout.">
          <Input
            id="pdf-statement-currency"
            className={cn(DENSE, "text-[10px] uppercase", needs("pdf-statement-currency") && QUESTION_FIELD)}
            value={guidance.currency ?? ""}
            maxLength={3}
            disabled={disabled}
            placeholder="ISO code"
            onChange={(event) => onChange({ currency: event.target.value.toUpperCase() || null })}
          />
        </PdfPanelField>
        <PdfPanelField label="Use as import date" htmlFor="pdf-import-date"
          hint="When a row prints more than one date, which one becomes the transaction date in Actual. Saved with the layout.">
          <Select
            id="pdf-import-date"
            size="sm"
            value={guidance.importDate}
            disabled={disabled}
            onValueChange={(value) => onChange({ importDate: value as PdfImportDate })}
            options={[
              { value: "transaction", label: "Transaction date" },
              { value: "posting", label: "Posting date" },
              { value: "value", label: "Value date" },
            ]}
          />
        </PdfPanelField>
        <PdfPanelField label="Printed sign means" htmlFor="pdf-printed-sign"
          hint="Whether a minus is money out (how banks print it) or money in (how card issuers print payments). Saved with the layout.">
          <Select
            id="pdf-printed-sign"
            size="sm"
            value={guidance.printedSign}
            disabled={disabled}
            onValueChange={(value) => onChange({ printedSign: value as PdfPrintedSign })}
            options={PRINTED_SIGNS.map((option) => ({ value: option.value, label: option.label }))}
          />
        </PdfPanelField>
        <PdfPanelField label="Amount direction" htmlFor="pdf-unsigned-direction"
          hint="What an amount with no sign, CR/DR marker or separate column means. Auto-detect only uses what the statement proves. Saved with the layout.">
          <Select
            id="pdf-unsigned-direction"
            size="sm"
            className={cn(needs("pdf-unsigned-direction") && QUESTION_FIELD)}
            value={guidance.unsignedDirection}
            disabled={disabled}
            onValueChange={(value) => onChange({ unsignedDirection: value as PdfParserGuidance["unsignedDirection"] })}
            options={[
              // Says what was found, as Account type does: automatic
              // detection should not be a black box.
              { value: "review", label: `Auto-detect (${detectedDirection})` },
              { value: "debit", label: "CR = money in; unmarked = money out" },
              { value: "credit", label: "DR = money out; unmarked = money in" },
            ]}
          />
        </PdfPanelField>
        <PdfPanelField label="Date format" htmlFor="pdf-date-format"
          hint="The order of day, month and year in dates like 03/04. Auto-detect reads it from dates that can only be read one way. Saved with the layout.">
          <Select
            id="pdf-date-format"
            size="sm"
            value={guidance.dateFormat}
            disabled={disabled}
            onValueChange={(value) => onChange({ dateFormat: value as PdfDateFormatOption })}
            options={DATE_FORMATS.map((option) => ({ value: option.value, label: option.label }))}
          />
        </PdfPanelField>
        <PdfPanelField label="Number format" htmlFor="pdf-number-format"
          hint="Which mark is the decimal point: 1,234.56 or 1.234,56. Saved with the layout.">
          <Select
            id="pdf-number-format"
            size="sm"
            value={guidance.numberFormat}
            disabled={disabled}
            onValueChange={(value) => onChange({ numberFormat: value as PdfNumberFormat })}
            options={NUMBER_FORMATS.map((option) => ({ value: option.value, label: option.label }))}
          />
        </PdfPanelField>

        {/*
          The period stays its own setting - it belongs to this statement and
          not to a saved layout - but that is a sentence worth reading once
          rather than a paragraph under the controls forever.
        */}
        <PdfPanelField
          label="Statement period"
          className="sm:col-span-2"
          hint="Read from this statement and used to check its dates. It is not kept in a saved layout, because it moves every month."
        >
          <span className="flex items-center gap-1.5">
            <DateInput
              size="sm"
              className="flex-1"
              value={guidance.statementPeriod.start ?? ""}
              disabled={disabled}
              id={PERIOD_START}
              aria-label="Statement period start"
              inputClassName={cn(needs(PERIOD_START) && QUESTION_FIELD)}
              onValueChange={(next) => onChange({ statementPeriod: { ...guidance.statementPeriod, start: next || null } })}
            />
            <span aria-hidden="true" className="shrink-0 text-[10px] text-muted-foreground">to</span>
            <DateInput
              size="sm"
              className="flex-1"
              value={guidance.statementPeriod.end ?? ""}
              disabled={disabled}
              aria-label="Statement period end"
              inputClassName={cn(needs(PERIOD_START) && QUESTION_FIELD)}
              onValueChange={(next) => onChange({ statementPeriod: { ...guidance.statementPeriod, end: next || null } })}
            />
          </span>
        </PdfPanelField>

        {/*
          Pages a saved layout always treats as carrying no transactions - a
          cover page, terms at the back - counted from each end so the rule
          holds however long next month's statement runs.
        */}
        <PdfPanelField
          label="Ignore first / last N pages"
          className="sm:col-span-2"
          hint="These pages carry no transactions. They are still read for the period, currency and balances. Saved with the layout."
        >
          <span className="flex items-center gap-3 text-xs">
            {(["ignoreFirst", "ignoreLast"] as const).map((key) => {
              const label = key === "ignoreFirst" ? "first" : "last";
              return (
                <label key={key} className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{label}</span>
                  <Input
                    type="number"
                    size="sm"
                    min={0}
                    max={MAX_PAGE_RULE}
                    step={1}
                    id={key === "ignoreFirst" ? PAGE_RULES_FIRST : undefined}
                    className={cn("w-20 text-right tabular-nums", needs(PAGE_RULES_FIRST) && QUESTION_FIELD)}
                    aria-label={`Ignore the ${label} N pages`}
                    value={String(guidance.pageRules[key])}
                    disabled={disabled}
                    onChange={(event) => {
                      const next = Math.min(MAX_PAGE_RULE, Math.max(0, Math.trunc(Number(event.target.value) || 0)));
                      onChange({ pageRules: { ...guidance.pageRules, [key]: next } });
                    }}
                  />
                </label>
              );
            })}
          </span>
        </PdfPanelField>
      </div>
    </PdfPanelSection>
  );
}

/** A field whose answer only the reader can give, and which rows are waiting on. */
const QUESTION_FIELD = "border-amber-500 dark:border-amber-400";
/** The user guide's account of how the parser reads a statement. */
const HOW_STATEMENTS_ARE_READ = "https://x-rous.github.io/actual-bench/user-guide/bank-reconciliation/#how-the-statement-is-read";

/** The ids "What needs attention" points at to settle an item. */
export const PERIOD_START = "pdf-statement-period-start";
export const PAGE_RULES_FIRST = "pdf-page-rules-first";
