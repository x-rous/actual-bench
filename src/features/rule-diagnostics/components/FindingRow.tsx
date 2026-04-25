"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { Copy, Merge } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStagedStore } from "@/store/staged";
import type { Finding, FindingCode, RuleRef, Severity } from "../types";

type Props = { finding: Finding };

const SEVERITY_VARIANT: Record<Severity, "destructive" | "status-warning" | "status-inactive"> = {
  error: "destructive",
  warning: "status-warning",
  info: "status-inactive",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

const COUNTERPART_PREFIX: Record<string, string> = {
  RULE_SHADOWED: "shadowed by",
  RULE_NEAR_DUPLICATE_PAIR: "near-duplicate of",
};

const MERGEABLE_CODES = new Set<FindingCode>([
  "RULE_NEAR_DUPLICATE_PAIR",
  "RULE_DUPLICATE_GROUP",
]);

const MERGE_INTENT: Partial<Record<FindingCode, "duplicate" | "near-duplicate">> = {
  RULE_DUPLICATE_GROUP: "duplicate",
  RULE_NEAR_DUPLICATE_PAIR: "near-duplicate",
};

function handleRuleLinkClick(e: MouseEvent<HTMLAnchorElement>, ruleId: string): void {
  const rules = useStagedStore.getState().rules;
  const entry = rules[ruleId];
  if (!entry || entry.isDeleted) {
    e.preventDefault();
    toast.error("This rule no longer exists in the current working set.");
  }
}

function copyUuid(id: string): void {
  const ok = () => toast.success("Rule ID copied");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(id).then(ok).catch(() => toast.error("Could not copy rule ID"));
  } else {
    toast.error("Clipboard is unavailable in this browser");
  }
}

function RuleChip({ rule }: { rule: RuleRef }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <Link
        href={`/rules?highlight=${rule.id}`}
        onClick={(e) => handleRuleLinkClick(e, rule.id)}
        aria-label={`Open rule: ${rule.summary}`}
        title={`UUID: ${rule.id}`}
        className="truncate rounded bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {rule.summary}
      </Link>
      <button
        type="button"
        onClick={() => copyUuid(rule.id)}
        aria-label={`Copy rule ID for ${rule.summary}`}
        title="Copy rule ID"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Copy className="h-3 w-3" />
      </button>
    </span>
  );
}

function MergeButton({ finding }: { finding: Finding }) {
  const router = useRouter();
  const ids = [
    ...finding.affected.map((r) => r.id),
    ...(finding.counterpart ? [finding.counterpart.id] : []),
  ];
  const intent = MERGE_INTENT[finding.code] ?? "near-duplicate";
  const count = ids.length;

  function handleClick() {
    if (count < 2) {
      toast.error("Need at least two rules to merge.");
      return;
    }
    const rulesMap = useStagedStore.getState().rules;
    const missing = ids.find((id) => !rulesMap[id] || rulesMap[id].isDeleted);
    if (missing) {
      toast.error("One of these rules no longer exists in the current working set.");
      return;
    }
    const url = `/rules?merge=${ids.join(",")}&from=diagnostics&intent=${intent}`;
    router.push(url);
  }

  return (
    <Button
      variant="outline"
      size="xs"
      onClick={handleClick}
      aria-label={`Merge ${count} rule${count !== 1 ? "s" : ""}`}
      title={`Merge ${count} rule${count !== 1 ? "s" : ""}`}
    >
      <Merge className="h-3 w-3" />
      Merge {count} rule{count !== 1 ? "s" : ""}
    </Button>
  );
}

export function FindingRow({ finding }: Props) {
  const prefix = COUNTERPART_PREFIX[finding.code];
  const showMergeButton = MERGEABLE_CODES.has(finding.code);

  return (
    <div className="flex flex-col gap-1.5 border-b border-border/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SEVERITY_VARIANT[finding.severity]} aria-label={`Severity: ${SEVERITY_LABEL[finding.severity]}`}>
          {SEVERITY_LABEL[finding.severity]}
        </Badge>
        <span className="text-sm font-medium">{finding.title}</span>
        {showMergeButton && <MergeButton finding={finding} />}
        <span className="ml-auto font-mono text-[10px] uppercase text-muted-foreground/70" aria-hidden="true">
          {finding.code}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{finding.message}</p>
      {finding.details && finding.details.length > 0 && (
        <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-5 text-xs text-muted-foreground">
          {finding.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
        {finding.affected.map((r) => (
          <RuleChip key={r.id} rule={r} />
        ))}
        {finding.counterpart && prefix && (
          <>
            <span className="text-[11px] text-muted-foreground">{prefix}</span>
            <RuleChip rule={finding.counterpart} />
          </>
        )}
      </div>
    </div>
  );
}
