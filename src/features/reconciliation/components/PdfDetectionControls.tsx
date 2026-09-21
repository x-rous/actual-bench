"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { PdfPanelField, PdfPanelNote, PdfPanelSection } from "./PdfPanelSection";
import type {
  PdfAccountType,
  PdfDateFormatOption,
  PdfImportDate,
  PdfNumberFormat,
  PdfParserGuidance,
  PdfPrintedSign,
} from "@/lib/reconciliation/statement/pdf";
import { accountTypeLabel, formatDateInput, parseDateInput } from "../lib/pdfReviewTable";
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
      <PdfPanelNote>
        Use these controls when the automatic date, number, account, or amount interpretation is wrong.
      </PdfPanelNote>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PdfPanelField label="Account type">
          <SelectField
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
            value={guidance.currency ?? ""}
            maxLength={3}
            disabled={disabled}
            placeholder="Detect or enter ISO code"
            onChange={(event) => onChange({ currency: event.target.value.toUpperCase() || null })}
            className="uppercase"
          />
        </PdfPanelField>
        <PdfPanelField label="Use as import date">
          <SelectField
            value={guidance.importDate}
            disabled={disabled}
            onChange={(event) => onChange({ importDate: event.target.value as PdfImportDate })}
          >
            <option value="transaction">Transaction date</option>
            <option value="posting">Posting date</option>
            <option value="value">Value date</option>
          </SelectField>
        </PdfPanelField>
        <PdfPanelField label="Printed sign means">
          <SelectField
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
            value={guidance.unsignedDirection}
            disabled={disabled}
            onChange={(event) => onChange({ unsignedDirection: event.target.value as PdfParserGuidance["unsignedDirection"] })}
          >
            <option value="review">Use signs or DR/CR; review unmarked</option>
            <option value="debit">CR = money in; unmarked = money out</option>
            <option value="credit">DR = money out; unmarked = money in</option>
          </SelectField>
        </PdfPanelField>
        <PdfPanelField label="Date format">
          <SelectField
            value={guidance.dateFormat}
            disabled={disabled}
            onChange={(event) => onChange({ dateFormat: event.target.value as PdfDateFormatOption })}
          >
            {DATE_FORMATS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
        </PdfPanelField>
        <PdfPanelField label="Number format">
          <SelectField
            value={guidance.numberFormat}
            disabled={disabled}
            onChange={(event) => onChange({ numberFormat: event.target.value as PdfNumberFormat })}
          >
            {NUMBER_FORMATS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
        </PdfPanelField>
      </div>

      {/*
        The period belongs to this statement, not to the bank's layout: it
        moves every month, and a saved layout never carries it. Kept here as
        its own group, with that said, because it sat among the settings a
        layout does keep and read as though it were one of them.
      */}
      <fieldset className="mt-1 rounded-md border px-3 py-2">
        <legend className="px-1 text-xs font-medium text-muted-foreground">Statement period</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PdfPanelField label="Starts">
            <PdfDateField
              value={guidance.statementPeriod.start}
              disabled={disabled}
              label="Statement period start"
              onChange={(next) => onChange({ statementPeriod: { ...guidance.statementPeriod, start: next } })}
            />
          </PdfPanelField>
          <PdfPanelField label="Ends">
            <PdfDateField
              value={guidance.statementPeriod.end}
              disabled={disabled}
              label="Statement period end"
              onChange={(next) => onChange({ statementPeriod: { ...guidance.statementPeriod, end: next } })}
            />
          </PdfPanelField>
        </div>
        <PdfPanelNote className="mt-2">
          Read from this statement, and used to check dates against it. Not kept in a saved layout.
        </PdfPanelNote>
      </fieldset>
    </PdfPanelSection>
  );
}

/** A date written the way the workbench writes dates, stored as ISO. */
function PdfDateField({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string | null;
  label: string;
  disabled: boolean;
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
      className={cn("tabular-nums", invalid && "border-destructive text-destructive")}
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
