import type { BudgetDiagnostic, DiagnosticSeverity } from "../types";

type Summary = Record<"total" | DiagnosticSeverity, number>;
type DiagnosticsRunStatus = "idle" | "loading" | "ready" | "error";
type IntegrityStatus = "idle" | "loading" | "error";
type CardTone = "default" | "error" | "warning" | "success";
type Card = {
  id: string;
  label: string;
  value: string;
  tone?: CardTone;
};

function summarize(findings: BudgetDiagnostic[]): Summary {
  return findings.reduce<Summary>(
    (acc, finding) => {
      acc.total += 1;
      acc[finding.severity] += 1;
      return acc;
    },
    { total: 0, error: 0, warning: 0, info: 0 }
  );
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function runStatusLabel(status: DiagnosticsRunStatus): string {
  if (status === "loading") return "Running";
  if (status === "ready") return "Complete";
  if (status === "error") return "Error";
  return "Waiting";
}

function integrityLabel(findings: BudgetDiagnostic[], status: IntegrityStatus): string {
  if (status === "loading") return "Running";
  if (status === "error") return "Error";
  return findings.some((finding) => finding.code === "SQLITE_INTEGRITY_CHECK")
    ? "Checked"
    : "Not run";
}

function toneClass(tone: CardTone | undefined): string {
  if (tone === "error") return "text-destructive";
  if (tone === "warning") return "text-amber-700 dark:text-amber-400";
  if (tone === "success") return "text-emerald-700 dark:text-emerald-400";
  return "text-foreground";
}

export function DiagnosticsSummaryCards({
  findings,
  status,
  integrityStatus,
}: {
  findings: BudgetDiagnostic[];
  status: DiagnosticsRunStatus;
  integrityStatus: IntegrityStatus;
}) {
  const summary = summarize(findings);
  const cards: Card[] = [
    {
      id: "run-state",
      label: "Run state",
      value: runStatusLabel(status),
      tone: status === "error" ? "error" : status === "ready" ? "success" : "default",
    },
    { id: "total", label: "Total findings", value: formatCount(summary.total) },
    {
      id: "error",
      label: "Errors",
      value: formatCount(summary.error),
      tone: summary.error > 0 ? "error" : "default",
    },
    {
      id: "warning",
      label: "Warnings",
      value: formatCount(summary.warning),
      tone: summary.warning > 0 ? "warning" : "default",
    },
    { id: "info", label: "Info", value: formatCount(summary.info) },
    {
      id: "integrity",
      label: "Integrity",
      value: integrityLabel(findings, integrityStatus),
      tone: integrityStatus === "error" ? "error" : "default",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <div key={card.id} className="rounded-md border border-border/70 bg-muted/12 p-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {card.label}
          </div>
          <div className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass(card.tone)}`}>
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}
