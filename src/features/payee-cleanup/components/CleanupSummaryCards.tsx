import type { CleanupScanResult } from "../lib/scan";
import type { CleanupPlan } from "../lib/plan";

type Props = {
  result: CleanupScanResult;
  plan: CleanupPlan;
};

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * The scan totals (RD-078 §11).
 *
 * No "payees analyzed" box: the toolbar already states it, and repeating a
 * number two inches below itself is space that could hold a suggestion.
 *
 * The fourth box is what the user is about to do, rather than another way of
 * describing what the scan found. It carries its own "not written until you
 * save" caption, so the safety model sits with the pending changes instead of
 * needing a strip of its own.
 */
export function CleanupSummaryCards({ result, plan }: Props) {
  const pendingParts = [
    plan.merges.length > 0
      ? `${plan.merges.length} ${plan.merges.length === 1 ? "merge" : "merges"}`
      : null,
    plan.renames.length > 0
      ? `${plan.renames.length} ${plan.renames.length === 1 ? "rename" : "renames"}`
      : null,
    // Extensions count as rules here on purpose: from the user's side "add this
    // text to the rule you already have" is one rule change, and splitting the
    // two apart in a summary would invite the question of what the difference is.
    plan.rules.length + plan.ruleExtensions.length > 0
      ? `${plan.rules.length + plan.ruleExtensions.length} ${
          plan.rules.length + plan.ruleExtensions.length === 1 ? "rule" : "rules"
        }`
      : null,
    plan.deletions.length > 0 ? `${plan.deletions.length} deleted` : null,
  ].filter(Boolean);

  const mergedPayeeCount = plan.merges.reduce((n, m) => n + m.mergeIds.length, 0);

  const scanCards = [
    {
      id: "suggestions",
      label: "Cleanup suggestions",
      value: formatCount(
        result.counts.high + result.counts.strong + result.counts.review
      ),
      tone: "neutral" as const,
    },
    {
      id: "high",
      label: "High confidence",
      value: formatCount(result.counts.high),
      tone: "neutral" as const,
    },
    {
      id: "review",
      label: "Need review",
      value: formatCount(result.counts.review),
      tone: "caution" as const,
    },
  ];

  const pendingActive = pendingParts.length > 0;

  return (
    // Two groups, not four equal boxes: three describe what the scan found,
    // one describes what the user is about to do. The rule between them says
    // that without a heading.
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      <div className="grid flex-1 gap-3 sm:grid-cols-3">
        {scanCards.map((card) => (
          <div
            key={card.id}
            className="rounded-md border border-border/70 bg-muted/12 p-3"
          >
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {card.label}
            </div>
            <div
              className={
                "mt-2 text-2xl font-semibold tracking-tight " +
                (card.tone === "caution" && result.counts.review > 0
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-foreground")
              }
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <div
        className="hidden w-px shrink-0 self-stretch bg-border/70 lg:block"
        aria-hidden="true"
      />

      <div
        className={
          "rounded-md border p-3 lg:w-72 lg:shrink-0 " +
          (pendingActive
            ? "border-emerald-600/40 bg-emerald-500/5"
            : "border-border/70 bg-muted/12")
        }
      >
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Pending changes
        </div>
        <div className="mt-2 text-sm font-semibold tracking-tight text-foreground">
          {pendingActive ? pendingParts.join(" · ") : "None yet"}
        </div>
        {pendingActive ? (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {mergedPayeeCount} {mergedPayeeCount === 1 ? "payee stops" : "payees stop"}{" "}
            existing · not written until you save
          </div>
        ) : null}
      </div>
    </div>
  );
}
