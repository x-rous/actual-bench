import type { Finding, Severity } from "../types";
import { FindingRow } from "./FindingRow";

type Props = { findings: Finding[] };

const SEVERITY_ORDER: Severity[] = ["error", "warning", "info"];
const SEVERITY_HEADING: Record<Severity, string> = {
  error: "Errors",
  warning: "Warnings",
  info: "Info",
};

export function DiagnosticsTable({ findings }: Props) {
  const bySeverity: Record<Severity, Finding[]> = { error: [], warning: [], info: [] };
  for (const f of findings) {
    bySeverity[f.severity].push(f);
  }

  if (findings.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col">
      {SEVERITY_ORDER.map((sev) => {
        const group = bySeverity[sev];
        if (group.length === 0) return null;
        return (
          <section key={sev} aria-label={`${SEVERITY_HEADING[sev]} findings`}>
            <h2 className="sticky top-0 z-10 border-b border-border bg-background px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {SEVERITY_HEADING[sev]} ({group.length})
            </h2>
            <div>
              {group.map((f, i) => (
                <FindingRow key={`${f.code}-${f.affected[0]?.id ?? "none"}-${i}`} finding={f} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
