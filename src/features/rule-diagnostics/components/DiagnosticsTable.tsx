import type { Rule } from "@/types/entities";
import type { Finding } from "../types";
import { FindingCard } from "./FindingCard";

type Props = {
  findings: Finding[];
  rulesById: Map<string, Rule>;
  onDismiss?: (finding: Finding) => void;
  onRestore?: (finding: Finding) => void;
};

/**
 * A flat list, in rank order.
 *
 * It grouped by severity, and briefly offered grouping by rule as well. Both
 * are gone. Severity headings repeated the badge already on every card and the
 * filter already above it; grouping by rule produced one heading per finding,
 * because almost no rule carries more than one — and where a rule does carry
 * several, the ranking already puts them together, since "findings on the same
 * rule" is one of the signals it sorts on.
 *
 * What is left is the order the ranking chose: what is broken first, then what
 * fixing it is worth.
 */
export function DiagnosticsTable({ findings, rulesById, onDismiss, onRestore }: Props) {
  if (findings.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col">
      {findings.map((f, i) => (
        <FindingCard
          key={`${f.code}-${f.affected[0]?.id ?? "none"}-${i}`}
          finding={f}
          rulesById={rulesById}
          onDismiss={onDismiss}
          onRestore={onRestore}
        />
      ))}
    </div>
  );
}
