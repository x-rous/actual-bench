"use client";

import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { cn } from "@/lib/utils";
import type {
  PdfAccountType,
  PdfDateFormatOption,
  PdfImportDate,
  PdfNumberFormat,
  PdfParserGuidance,
  PdfPrintedSign,
} from "@/lib/reconciliation/statement/pdf";
import { accountTypeLabel } from "../lib/pdfReviewTable";

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
    <section className="rounded-md border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform", !open && "-rotate-90")} />
        <span className="text-sm font-medium">Statement interpretation</span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground">
          {accountTypeLabel(accountType)} · {guidance.currency ?? "currency automatic"} · import {importDateLabel.toLowerCase()}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <p className="text-xs text-muted-foreground">
            Use these controls when the automatic date, number, account, or amount interpretation is wrong.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Control label="Account type">
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
            </Control>
            <Control label="Statement currency" htmlFor="pdf-statement-currency">
              <Input
                id="pdf-statement-currency"
                value={guidance.currency ?? ""}
                maxLength={3}
                disabled={disabled}
                placeholder="Detect or enter ISO code"
                onChange={(event) => onChange({ currency: event.target.value.toUpperCase() || null })}
                className="uppercase"
              />
            </Control>
            <Control label="Use as import date">
              <SelectField
                value={guidance.importDate}
                disabled={disabled}
                onChange={(event) => onChange({ importDate: event.target.value as PdfImportDate })}
              >
                <option value="transaction">Transaction date</option>
                <option value="posting">Posting date</option>
                <option value="value">Value date</option>
              </SelectField>
            </Control>
            <Control label="Printed sign means">
              <SelectField
                value={guidance.printedSign}
                disabled={disabled}
                onChange={(event) => onChange({ printedSign: event.target.value as PdfPrintedSign })}
              >
                {PRINTED_SIGNS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </SelectField>
            </Control>
            <Control label="Amount direction" htmlFor="pdf-unsigned-direction">
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
            </Control>
            <Control label="Date format">
              <SelectField
                value={guidance.dateFormat}
                disabled={disabled}
                onChange={(event) => onChange({ dateFormat: event.target.value as PdfDateFormatOption })}
              >
                {DATE_FORMATS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </SelectField>
            </Control>
            <Control label="Statement starts">
              <Input
                type="date"
                value={guidance.statementPeriod.start ?? ""}
                disabled={disabled}
                onChange={(event) => onChange({ statementPeriod: { ...guidance.statementPeriod, start: event.target.value || null } })}
              />
            </Control>
            <Control label="Statement ends">
              <Input
                type="date"
                value={guidance.statementPeriod.end ?? ""}
                disabled={disabled}
                onChange={(event) => onChange({ statementPeriod: { ...guidance.statementPeriod, end: event.target.value || null } })}
              />
            </Control>
            <Control label="Number format">
              <SelectField
                value={guidance.numberFormat}
                disabled={disabled}
                onChange={(event) => onChange({ numberFormat: event.target.value as PdfNumberFormat })}
              >
                {NUMBER_FORMATS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </SelectField>
            </Control>
          </div>
        </div>
      )}
    </section>
  );
}

function Control({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
