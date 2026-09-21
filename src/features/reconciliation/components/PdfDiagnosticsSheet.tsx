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
import { accountTypeLabel } from "../lib/pdfReviewTable";
import { PdfDetectionIssueList, type PdfDetectionIssue } from "./PdfDetectionIssueList";
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
  issues,
  warnings,
  profiles,
  onResolveIssue,
  onApplyProfile,
  onCopyDiagnostics,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: PdfStatementParseResult;
  issues: PdfDetectionIssue[];
  warnings: string[];
  profiles: PdfDetectionProfileOption[];
  onResolveIssue: (issue: PdfDetectionIssue) => void;
  onApplyProfile: (option: PdfDetectionProfileOption, profile: PdfLayoutProfile) => void;
  onCopyDiagnostics: () => void;
}) {
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
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border p-3 text-xs">
            <Metric label="Pages read" value={`${result.metrics.transactionPages} of ${result.metrics.pages}`} />
            <Metric label="Transactions" value={String(result.metrics.transactions)} />
            <Metric label="Ready" value={String(result.metrics.accepted)} tone="positive" />
            <Metric
              label="Needs review"
              value={String(result.metrics.review + result.metrics.rejected)}
              tone={result.metrics.review + result.metrics.rejected ? "warning" : "normal"}
            />
            <Metric label="Account type" value={accountTypeLabel(result.accountType)} />
          </dl>

          <PdfDetectionIssueList
            label="Parsing warnings"
            issues={issues}
            extraMessages={warnings}
            onResolve={(issue) => {
              onOpenChange(false);
              onResolveIssue(issue);
            }}
          />

          <Disclosure title="Saved layouts and validation">
            <p className="text-xs text-muted-foreground">
              Saved layouts contain geometry and roles, not customer names, account numbers, or transaction text.
            </p>
            <div className="mt-3 space-y-2">
              {profiles.map((option) => {
                const profile = option.envelope.profile;
                const match = matchPdfLayoutProfile(profile, result.reconstructedPages, result.activeSchema, result.detectionSignature);
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

function Metric({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "positive" | "negative" | "warning";
}) {
  return (
    <div className="flex items-baseline gap-1 whitespace-nowrap">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "font-semibold tabular-nums",
          tone === "positive" && "text-emerald-700 dark:text-emerald-400",
          tone === "negative" && "text-red-600 dark:text-red-400",
          tone === "warning" && "text-amber-700 dark:text-amber-300"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
