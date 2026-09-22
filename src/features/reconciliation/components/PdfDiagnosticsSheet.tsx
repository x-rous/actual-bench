"use client";

import { useState } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { PdfLayoutProfile, PdfStatementParseResult } from "@/lib/reconciliation/statement/pdf";
import { matchPdfLayoutProfile } from "@/lib/reconciliation/statement/pdf";
import { PDF_REASON_TEXT } from "../lib/pdfReasonText";
import { accountTypeLabel, reasonBreakdown, type PdfReviewCategory } from "../lib/pdfReviewTable";
import type { PdfDetectionProfileOption } from "./PdfStatementReviewDialog";

/**
 * Everything about how the parse went, without taking the workbench away.
 *
 * This used to replace the whole dialog body, so reading a warning meant
 * leaving the rows the warning was about. A sheet keeps the work behind it and
 * closes back onto exactly what the reader left.
 */
export function PdfDiagnosticsSheet({
  open,
  onOpenChange,
  result,
  layoutInForce,
  profiles,
  onApplyProfile,
  onShowRows,
  onCopyDiagnostics,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: PdfStatementParseResult;
  /** The saved layout being read with, when there is one. */
  layoutInForce: PdfDetectionProfileOption | null;
  profiles: PdfDetectionProfileOption[];
  onApplyProfile: (option: PdfDetectionProfileOption, profile: PdfLayoutProfile) => void;
  onShowRows: (category: PdfReviewCategory) => void;
  onCopyDiagnostics: () => void;
}) {
  const transactionPages = [...new Set(result.regions
    .filter((region) => region.included && region.kind === "transactions")
    .map((region) => region.pageNumber))].sort((left, right) => left - right);
  const breakdown = reasonBreakdown(result.transactions);

  /**
   * Where a setting came from.
   *
   * The same value can be the parser's reading, the reader's correction, or
   * something a saved layout brought with it, and which of the three it is
   * changes what to do about a statement that came out wrong.
   */
  const sourceOf = (key: keyof PdfLayoutProfile["reading"]) => {
    const applied = result.guidance[key as keyof typeof result.guidance];
    if (applied === result.detectedGuidance[key as keyof typeof result.detectedGuidance]) return "detected";
    if (layoutInForce && applied === layoutInForce.envelope.profile.reading[key]) {
      return `from ${layoutInForce.envelope.profile.name}`;
    }
    return "your setting";
  };

  return (
    // Not modal: reading a warning is something you do while looking at the
    // rows it is about, so the workbench behind stays live rather than inert.
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      {/*
        The width has to carry the same variant as the sheet's own
        `data-[side=right]:sm:max-w-sm`, or both survive the class merge and
        the data-attribute selector wins on specificity - which is how this
        panel stayed narrow while claiming to be wide.
      */}
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Parser details</SheetTitle>
          <SheetDescription>What Actual Bench used to read this statement.</SheetDescription>
        </SheetHeader>

        <div className="space-y-3 overflow-y-auto px-4 pb-4">
          {/*
            What the workbench header does not already say. The counts that
            used to stand here - transactions, ready, needs review - are in the
            summary bar permanently, and repeating them in another grouping
            with other names only invited the reader to reconcile the two.
          */}
          <section aria-label="How this was read" className="rounded-md border">
            <h3 className="border-b px-3 py-2 text-sm font-medium">How this was read</h3>
            <dl className="divide-y text-xs">
              <Reading label="Account type" value={accountTypeLabel(result.accountType)} source={sourceOf("accountType")} />
              <Reading label="Currency" value={result.guidance.currency ?? "Not identified"} source={sourceOf("currency")} />
              <Reading label="Date format" value={DATE_FORMAT_LABELS[result.guidance.dateFormat]} source={sourceOf("dateFormat")} />
              <Reading label="Number format" value={NUMBER_FORMAT_LABELS[result.guidance.numberFormat]} source={sourceOf("numberFormat")} />
              <Reading label="Import date" value={IMPORT_DATE_LABELS[result.guidance.importDate]} source={sourceOf("importDate")} />
              <Reading label="Unmarked amounts" value={UNSIGNED_LABELS[result.guidance.unsignedDirection]} source={sourceOf("unsignedDirection")} />
              <Reading label="Printed sign" value={PRINTED_SIGN_LABELS[result.guidance.printedSign ?? "auto"]} source={sourceOf("printedSign")} />
              <Reading
                label="Balance column"
                value={result.balancePolarity
                  ? `${result.balancePolarity.direction === "deposit" ? "Rises on money in" : "Rises on money out"}`
                  : "Not used"}
                source={result.balancePolarity ? BALANCE_SOURCES[result.balancePolarity.source] : "no running balance read"}
              />
              <Reading
                label="Transaction pages"
                value={transactionPages.length ? pageList(transactionPages) : "None"}
                source={`${result.metrics.pages} ${result.metrics.pages === 1 ? "page" : "pages"} in the document`}
              />
            </dl>
          </section>

          {breakdown.length > 0 && (
            <section aria-label="Why rows are not ready" className="rounded-md border">
              <h3 className="border-b px-3 py-2 text-sm font-medium">Why rows are not ready</h3>
              <ul className="divide-y text-xs">
                {breakdown.map((entry) => (
                  <li key={entry.reason}>
                    <button
                      type="button"
                      className="flex w-full items-baseline gap-3 px-3 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        onOpenChange(false);
                        onShowRows(entry.category);
                      }}
                    >
                      <span className="w-8 shrink-0 text-right font-medium tabular-nums">{entry.count}</span>
                      <span className="min-w-0 flex-1">{PDF_REASON_TEXT[entry.reason]}</span>
                      <span className="shrink-0 text-muted-foreground">Show</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Disclosure title="Saved layouts and validation">
            <p className="text-xs text-muted-foreground">
              Saved layouts contain geometry and roles, not customer names, account numbers, or transaction text.
            </p>
            <div className="mt-3 space-y-2">
              {profiles.map((option) => {
                const profile = option.envelope.profile;
                const match = matchPdfLayoutProfile(profile, result);
                return (
                  <div key={option.recordId} className="rounded border p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{option.bankName} · {profile.name}</span>
                      <span className="text-muted-foreground">
                        {match?.outcome} · {Math.round((match?.score ?? 0) * 100)}%
                      </span>
                      <Button
                        className="ml-auto"
                        size="xs"
                        variant="outline"
                        disabled={match?.outcome === "conflicting"}
                        onClick={() => {
                          onOpenChange(false);
                          onApplyProfile(option, profile);
                        }}
                      >
                        Apply and validate
                      </Button>
                    </div>
                    <p className="mt-1 text-muted-foreground">{match?.reasons.join("; ")}</p>
                  </div>
                );
              })}
              {profiles.length === 0 && <p className="text-sm text-muted-foreground">No saved statement layouts.</p>}
            </div>
          </Disclosure>

          <Disclosure title="Technical diagnostics">
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">
                Contains stage names, counts, and page numbers only. Statement text and source IDs are not copied.
              </p>
              <Button className="ml-auto shrink-0" size="xs" variant="outline" onClick={onCopyDiagnostics}>
                <Copy aria-hidden="true" className="mr-1 size-3" />Copy diagnostics
              </Button>
            </div>
            <ol className="mt-3 space-y-1 font-mono text-[11px]">
              {result.diagnostics.map((event, index) => (
                <li key={`${event.stage}-${event.code}-${index}`}>
                  {event.stage}: {event.code} {JSON.stringify(event.metrics ?? {})}
                </li>
              ))}
            </ol>
          </Disclosure>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Reading({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-baseline gap-2 px-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium">{value}</dd>
      <dd className="text-[11px] text-muted-foreground">{source}</dd>
    </div>
  );
}

function pageList(pageNumbers: number[]) {
  if (pageNumbers.length === 1) return `Page ${pageNumbers[0]}`;
  return `Pages ${pageNumbers.slice(0, -1).join(", ")} and ${pageNumbers.at(-1)}`;
}

const DATE_FORMAT_LABELS: Record<string, string> = {
  auto: "Read from the statement",
  dmy: "Day / month / year",
  mdy: "Month / day / year",
  ymd: "Year / month / day",
  "dmy-name": "Month-name date",
  iso: "ISO year-month-day",
  "ymd-compact": "Compact YYYYMMDD",
};

const NUMBER_FORMAT_LABELS: Record<string, string> = {
  auto: "Read from the statement",
  us: "1,234.56",
  european: "1.234,56",
  space: "1 234,56",
  indian: "1,23,456.78",
  swiss: "1'234.56",
};

const IMPORT_DATE_LABELS: Record<string, string> = {
  transaction: "Transaction date",
  posting: "Posting date",
  value: "Value date",
};

const UNSIGNED_LABELS: Record<string, string> = {
  review: "Left for review",
  debit: "Read as money out",
  credit: "Read as money in",
};

const PRINTED_SIGN_LABELS: Record<string, string> = {
  auto: "Read from the account type",
  "account-holder": "Minus is money out",
  issuer: "Minus is money in",
};

const BALANCE_SOURCES: Record<string, string> = {
  evidence: "from the statement's own directions",
  "confirmed-type": "from the account type you confirmed",
  "detected-type": "from a detected account type",
};

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={title} className="rounded-md border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform", !open && "-rotate-90")} />
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}
