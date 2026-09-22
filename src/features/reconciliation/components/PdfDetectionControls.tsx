"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { PdfPanelField, PdfPanelSection } from "./PdfPanelSection";
import type {
  PdfAccountType,
  PdfDateFormatOption,
  PdfImportDate,
  PdfNumberFormat,
  PdfParserGuidance,
  PdfPrintedSign,
} from "@/lib/reconciliation/statement/pdf";
import { accountTypeLabel, formatDateInput, parseDateInput } from "../lib/pdfReviewTable";

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
  focusRequest,
  open,
  disabled,
  onOpenChange,
  onChange,
}: {
  guidance: PdfParserGuidance;
  accountType: PdfAccountType;
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

  const importDateLabel = guidance.importDate === "transaction"
    ? "Transaction date"
    : guidance.importDate === "posting" ? "Posting date" : "Value date";

  return (
    <PdfPanelSection
      title="Statement interpretation"
      open={open}
      onOpenChange={onOpenChange}
      summary={`${accountTypeLabel(accountType)} · ${guidance.currency ?? "currency automatic"} · import ${importDateLabel.toLowerCase()}`}
    >
      {/*
        No sentence introducing the controls: the section is named, and the
        line under its name already says how this statement is being read.
        Three columns where there is room, because a setting is one short row.
      */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        <PdfPanelField label="Account type" htmlFor="pdf-account-type">
          <SelectField
            id="pdf-account-type"
            className={DENSE}
            value={guidance.accountType}
            disabled={disabled}
            onChange={(event) => onChange({ accountType: event.target.value as PdfParserGuidance["accountType"] })}
          >
            <option value="auto">Auto-detect ({accountTypeLabel(accountType)})</option>
            {ACCOUNT_TYPES.map((value) => (
              <option key={value} value={value}>{accountTypeLabel(value)}</option>
            ))}
          </SelectField>
        </PdfPanelField>
        <PdfPanelField label="Statement currency" htmlFor="pdf-statement-currency">
          <Input
            id="pdf-statement-currency"
            className={cn(DENSE, "text-[10px] uppercase")}
            value={guidance.currency ?? ""}
            maxLength={3}
            disabled={disabled}
            placeholder="ISO code"
            onChange={(event) => onChange({ currency: event.target.value.toUpperCase() || null })}
          />
        </PdfPanelField>
        <PdfPanelField label="Use as import date" htmlFor="pdf-import-date">
          <SelectField
            id="pdf-import-date"
            className={DENSE}
            value={guidance.importDate}
            disabled={disabled}
            onChange={(event) => onChange({ importDate: event.target.value as PdfImportDate })}
          >
            <option value="transaction">Transaction date</option>
            <option value="posting">Posting date</option>
            <option value="value">Value date</option>
          </SelectField>
        </PdfPanelField>
        <PdfPanelField label="Printed sign means" htmlFor="pdf-printed-sign">
          <SelectField
            id="pdf-printed-sign"
            className={DENSE}
            value={guidance.printedSign}
            disabled={disabled}
            onChange={(event) => onChange({ printedSign: event.target.value as PdfPrintedSign })}
          >
            {PRINTED_SIGNS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
        </PdfPanelField>
        <PdfPanelField label="Amount direction" htmlFor="pdf-unsigned-direction">
          <SelectField
            id="pdf-unsigned-direction"
            className={DENSE}
            value={guidance.unsignedDirection}
            disabled={disabled}
            onChange={(event) => onChange({ unsignedDirection: event.target.value as PdfParserGuidance["unsignedDirection"] })}
          >
            <option value="review">Use signs or DR/CR; review unmarked</option>
            <option value="debit">CR = money in; unmarked = money out</option>
            <option value="credit">DR = money out; unmarked = money in</option>
          </SelectField>
        </PdfPanelField>
        <PdfPanelField label="Date format" htmlFor="pdf-date-format">
          <SelectField
            id="pdf-date-format"
            className={DENSE}
            value={guidance.dateFormat}
            disabled={disabled}
            onChange={(event) => onChange({ dateFormat: event.target.value as PdfDateFormatOption })}
          >
            {DATE_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
        </PdfPanelField>
        <PdfPanelField label="Number format" htmlFor="pdf-number-format">
          <SelectField
            id="pdf-number-format"
            className={DENSE}
            value={guidance.numberFormat}
            disabled={disabled}
            onChange={(event) => onChange({ numberFormat: event.target.value as PdfNumberFormat })}
          >
            {NUMBER_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
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
            <PdfDateField
              className="flex-1"
              value={guidance.statementPeriod.start}
              disabled={disabled}
              label="Statement period start"
              onChange={(next) => onChange({ statementPeriod: { ...guidance.statementPeriod, start: next } })}
            />
            <span aria-hidden="true" className="shrink-0 text-[10px] text-muted-foreground">to</span>
            <PdfDateField
              className="flex-1"
              value={guidance.statementPeriod.end}
              disabled={disabled}
              label="Statement period end"
              onChange={(next) => onChange({ statementPeriod: { ...guidance.statementPeriod, end: next } })}
            />
          </span>
        </PdfPanelField>
      </div>
    </PdfPanelSection>
  );
}

/** A date written the way the workbench writes dates, stored as ISO. */
function PdfDateField({
  value,
  label,
  disabled,
  className,
  onChange,
}: {
  value: string | null;
  label: string;
  disabled: boolean;
  className?: string;
  onChange: (value: string | null) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  return (
    <Input
      key={value ?? ""}
      aria-label={label}
      aria-invalid={invalid || undefined}
      defaultValue={formatDateInput(value)}
      disabled={disabled}
      placeholder="dd/mm/yyyy"
      className={cn("h-7 w-full text-[10px] tabular-nums", className, invalid && "border-destructive text-destructive")}
      onBlur={(event) => {
        const text = event.target.value.trim();
        if (text === formatDateInput(value)) {
          setInvalid(false);
          return;
        }
        if (!text) {
          setInvalid(false);
          onChange(null);
          return;
        }
        const parsed = parseDateInput(text);
        if (!parsed) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        onChange(parsed);
      }}
    />
  );
}
