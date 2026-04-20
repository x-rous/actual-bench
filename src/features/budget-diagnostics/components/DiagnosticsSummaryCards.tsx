import type { BudgetDiagnostic, DiagnosticSeverity } from "../types";

type Summary = Record<"total" | DiagnosticSeverity, number>;

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

const CARDS: Array<{ id: keyof Summary; label: string }> = [
  { id: "total", label: "Total findings" },
  { id: "error", label: "Errors" },
  { id: "warning", label: "Warnings" },
  { id: "info", label: "Infos" },
];

export function DiagnosticsSummaryCards({
  findings,
}: {
  findings: BudgetDiagnostic[];
}) {
  const summary = summarize(findings);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CARDS.map((card) => (
        <div key={card.id} className="rounded-md border border-border/70 bg-muted/12 p-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {card.label}
          </div>
          <div className="mt-2 text-2xl font-semibold tracking-tight">
            {summary[card.id].toLocaleString("en-US")}
          </div>
        </div>
      ))}
    </div>
  );
}
