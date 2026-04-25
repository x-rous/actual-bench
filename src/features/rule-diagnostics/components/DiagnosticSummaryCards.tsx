import type { DiagnosticReport } from "../types";

type Props = {
  summary: DiagnosticReport["summary"];
};

function toneClass(count: number, tone: "error" | "warning" | "info"): string {
  if (count === 0) return "text-foreground";
  if (tone === "error") return "text-destructive";
  if (tone === "warning") return "text-amber-700 dark:text-amber-400";
  return "text-sky-700 dark:text-sky-400";
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function DiagnosticSummaryCards({ summary }: Props) {
  const cards = [
    { id: "error", label: "Errors", value: summary.error, tone: "error" as const },
    { id: "warning", label: "Warnings", value: summary.warning, tone: "warning" as const },
    { id: "info", label: "Info", value: summary.info, tone: "info" as const },
    { id: "total", label: "Total", value: summary.total, tone: "info" as const },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.id}
          className="rounded-md border border-border/70 bg-muted/12 p-3"
          aria-label={`${formatCount(card.value)} ${card.label.toLowerCase()}`}
        >
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {card.label}
          </div>
          <div
            className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass(card.value, card.tone)}`}
          >
            {formatCount(card.value)}
          </div>
        </div>
      ))}
    </div>
  );
}
