import { AlertCircle, Download, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { csvField } from "@/lib/csv";
import type { BudgetDiagnostic, DiagnosticsPayload } from "../types";
import { DiagnosticsSummaryCards } from "./DiagnosticsSummaryCards";
import { DiagnosticsTable } from "./DiagnosticsTable";

type DiagnosticsSectionProps = {
  diagnostics: DiagnosticsPayload | null;
  status: "idle" | "loading" | "ready" | "error";
  errorMessage: string | null;
  integrityStatus: "idle" | "loading" | "error";
  integrityError: string | null;
  onRunIntegrityCheck: () => void;
};

function buildFindingsCsv(findings: BudgetDiagnostic[]): string {
  const header = [
    "code",
    "severity",
    "title",
    "message",
    "table",
    "rowId",
    "relatedTable",
    "relatedId",
  ];
  const rows = findings.map((finding) =>
    [
      finding.code,
      finding.severity,
      finding.title,
      finding.message,
      finding.table,
      finding.rowId,
      finding.relatedTable,
      finding.relatedId,
    ].map(csvField).join(",")
  );
  return `\uFEFF${[header.map(csvField).join(","), ...rows].join("\r\n")}`;
}

function downloadFindingsCsv(findings: BudgetDiagnostic[]) {
  const blob = new Blob([buildFindingsCsv(findings)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `budget-diagnostics-findings-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DiagnosticsSection({
  diagnostics,
  status,
  errorMessage,
  integrityStatus,
  integrityError,
  onRunIntegrityCheck,
}: DiagnosticsSectionProps) {
  const findings = diagnostics?.findings ?? [];
  const loading = status === "loading";
  const hasFindings = findings.length > 0;

  return (
    <section className="bg-background">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Diagnostics</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Deterministic SQLite, schema, relationship, and snapshot findings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!diagnostics || integrityStatus === "loading"}
            onClick={onRunIntegrityCheck}
            title="May take minutes on large budgets"
          >
            {integrityStatus === "loading" ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <ShieldCheck data-icon="inline-start" />
            )}
            Full integrity check
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasFindings}
            onClick={() => downloadFindingsCsv(findings)}
          >
            <Download data-icon="inline-start" />
            Export findings CSV
          </Button>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {loading && (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-5">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Running diagnostics</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Checking SQLite health, schema shape, relationships, and metadata.
                </p>
              </div>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-md border border-destructive/25 bg-destructive/5 p-4">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  Diagnostics failed
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {errorMessage ?? "Unable to run diagnostics for this snapshot."}
                </p>
              </div>
            </div>
          </div>
        )}

        {integrityStatus === "error" && (
          <div className="rounded-md border border-destructive/25 bg-destructive/5 p-4">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  Integrity check failed to run
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {integrityError ?? "Unable to run PRAGMA integrity_check."}
                </p>
              </div>
            </div>
          </div>
        )}

        {diagnostics && (
          <>
            <DiagnosticsSummaryCards
              findings={findings}
              status={status}
              integrityStatus={integrityStatus}
            />
            <DiagnosticsTable findings={findings} />
          </>
        )}
      </div>
    </section>
  );
}
