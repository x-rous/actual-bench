"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleSlash, Copy, Merge, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStagedStore } from "@/store/staged";
import { ActionChip, ConditionChip } from "@/features/rules/components/RuleChips";
import type { EntityMaps } from "@/features/rules/utils/rulePreview";
import type { Rule } from "@/types/entities";
import type { Finding, FindingCode, RuleRef, Severity } from "../types";

type Props = {
  finding: Finding;
  rulesById: Map<string, Rule>;
  onDismiss?: (finding: Finding) => void;
  /** Present only on the Dismissed tab, where the action is the other way. */
  onRestore?: (finding: Finding) => void;
  /**
   * False when the section heading already names this rule — grouping by rule
   * put the same summary directly above the card, twice on screen for the
   * common case of one finding per rule. A finding about several rules always
   * lists them, because the list is the evidence.
   */
  showRules?: boolean;
  /** Opens the rule editor over this page. Absent renders the rule as plain text. */
  onOpenRule?: (ruleId: string) => void;
};

const SEVERITY_VARIANT: Record<Severity, "destructive" | "status-warning" | "status-inactive"> = {
  error: "destructive",
  warning: "status-warning",
  info: "status-inactive",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Suggestion",
};

/**
 * A colour bar down the edge of the card.
 *
 * The badge already names the severity, but a badge has to be read. A stripe is
 * seen — it lets someone scroll a long report and find where the errors are
 * without processing a word.
 */
const SEVERITY_STRIPE: Record<Severity, string> = {
  error: "border-l-destructive",
  warning: "border-l-amber-500",
  info: "border-l-sky-500/70",
};

/**
 * What the second rule is to the first, for the codes that name one.
 *
 * Only codes that actually pass a counterpart belong here. A prefix without one
 * never renders — which is how the old near-duplicate label sat dead in this
 * map while its message named one of its own rules as "the other".
 */
const COUNTERPART_LABEL: Partial<Record<FindingCode, string>> = {
  RULE_SHADOWED: "Shadowed by",
};

const MERGEABLE_CODES = new Set<FindingCode>([
  "RULE_NEAR_DUPLICATE_FAMILY",
  "RULE_DUPLICATE_GROUP",
]);

const MERGE_INTENT: Partial<Record<FindingCode, "duplicate" | "near-duplicate">> = {
  RULE_DUPLICATE_GROUP: "duplicate",
  RULE_NEAR_DUPLICATE_FAMILY: "near-duplicate",
};

/**
 * The entity graph the rule chips resolve ids against.
 *
 * The same selectors the Rules page uses, so a rule cannot read differently in
 * the two places.
 */
function useEntityMaps(): EntityMaps {
  const payees = useStagedStore((s) => s.payees);
  const categories = useStagedStore((s) => s.categories);
  const accounts = useStagedStore((s) => s.accounts);
  const categoryGroups = useStagedStore((s) => s.categoryGroups);
  const schedules = useStagedStore((s) => s.schedules);
  return useMemo(
    () => ({ payees, categories, accounts, categoryGroups, schedules }),
    [payees, categories, accounts, categoryGroups, schedules]
  );
}

/**
 * Whether a rule can still be opened.
 *
 * Kept as a guard rather than trusting the finding: a report is computed from a
 * snapshot, and the rule it names may have been deleted in the working set
 * since. Opening the editor on a deleted rule would show an empty form.
 */
export function canOpenRule(ruleId: string): boolean {
  const entry = useStagedStore.getState().rules[ruleId];
  if (!entry || entry.isDeleted) {
    toast.error("This rule no longer exists in the current working set.");
    return false;
  }
  return true;
}

/**
 * Whether a stage is worth a badge.
 *
 * Findings are partitioned on `stage|conditionsOp`, so every member of a family
 * or a duplicate group is in the same stage by construction, and shadowing is
 * stage-scoped too — a per-rule badge could never disagree with the card's. So
 * the stage is shown once, in the header.
 *
 * And only when it is `pre` or `post`. Almost every rule is `default`; printing
 * DEFAULT on every card is wallpaper, while PRE and POST are the cases that
 * change how a rule behaves relative to its neighbours.
 */
function noteworthyStage(stage: string | undefined): string | null {
  return stage && stage !== "default" ? stage : null;
}

/**
 * The rule itself, opening the editor in place.
 *
 * Two changes from the link this replaces. It is drawn with the Rules page's own
 * chips rather than as a flat sentence: a diagnostics finding is a claim *about*
 * a rule's conditions and actions, and reading it in one colourless line meant
 * re-parsing the rule to see the part the finding is talking about. And it opens
 * the editor over this page instead of navigating to Rules and highlighting a
 * row - the finding is the reason for the edit, and leaving the page to make it
 * loses that, then costs a trip back for the next one.
 *
 * `entity` is absent when the rule has gone from the working set since the
 * report was computed. The stored summary is the fallback, because a finding
 * that names a rule must still say which rule it named.
 */
export function RuleSummaryLink({
  rule,
  entity,
  maps,
  onOpen,
  className,
}: {
  rule: RuleRef;
  entity?: Rule;
  maps?: EntityMaps;
  onOpen?: (ruleId: string) => void;
  className?: string;
}) {
  const content =
    entity && maps ? (
      <RuleChipLine rule={entity} maps={maps} />
    ) : (
      <span className="break-words">{rule.summary}</span>
    );

  if (!onOpen) return <span className={className ?? BASE_RULE_LINE}>{content}</span>;

  return (
    <button
      type="button"
      onClick={() => {
        if (canOpenRule(rule.id)) onOpen(rule.id);
      }}
      aria-label={`Edit rule: ${rule.summary}`}
      className={cn(
        className ?? BASE_RULE_LINE,
        "text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      )}
    >
      {content}
    </button>
  );
}

const BASE_RULE_LINE = "block w-full rounded px-1 py-0.5 text-xs text-foreground";

/**
 * A rule's conditions and actions, in the Rules page's encoding.
 *
 * The components themselves, not a copy of them: they already resolve entity ids
 * to names and format every value type, which is exactly what a hand-rolled
 * version gets wrong.
 */
function RuleChipLine({ rule, maps }: { rule: Rule; maps: EntityMaps }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="flex flex-wrap items-center gap-1">
        {rule.conditions.map((condition, index) => (
          <span key={`c-${index}`} className="flex items-center gap-1">
            {index > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                {rule.conditionsOp === "or" ? "or" : "and"}
              </span>
            ) : null}
            <ConditionChip condition={condition} maps={maps} />
          </span>
        ))}
      </span>
      <span className="text-[11px] text-muted-foreground">then</span>
      <span className="flex flex-wrap items-center gap-1">
        {rule.actions.map((action, index) => (
          <ActionChip key={`a-${index}`} action={action} maps={maps} />
        ))}
      </span>
    </span>
  );
}

/**
 * One rule, as a row rather than a pill.
 *
 * A pill truncated at 160 characters made two long rules look identical when
 * they were not, and made a duplicate group look like a rendering fault — two
 * visually identical chips side by side. Given the width, the same text reads
 * as the finding's evidence.
 */
function RuleLine({
  rule,
  index,
  rulesById,
  maps,
  onOpenRule,
}: {
  rule: RuleRef;
  index?: number;
  rulesById: Map<string, Rule>;
  maps: EntityMaps;
  onOpenRule?: (ruleId: string) => void;
}) {
  return (
    <li className="flex gap-1.5 py-0.5">
      {index !== undefined && (
        <span className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground/70">
          {index}.
        </span>
      )}
      <RuleSummaryLink
        rule={rule}
        entity={rulesById.get(rule.id)}
        maps={maps}
        onOpen={onOpenRule}
      />
    </li>
  );
}

/** Section labels: present enough to orient, quiet enough to scan past. */
const LABEL_CLASS =
  "text-[10px] font-medium uppercase tracking-wider text-muted-foreground";

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
    router.push(`/rules?merge=${ids.join(",")}&from=diagnostics&intent=${intent}`);
  }

  return (
    <Button
      variant="outline"
      size="xs"
      onClick={handleClick}
      aria-label={`Merge ${count} rule${count !== 1 ? "s" : ""}`}
    >
      <Merge className="h-3 w-3" />
      Merge {count} rule{count !== 1 ? "s" : ""}
    </Button>
  );
}

function GeneraliseButton({ finding }: { finding: Finding }) {
  const router = useRouter();
  const ruleId = finding.affected[0]?.id;

  function handleClick() {
    if (!ruleId) return;
    const rulesMap = useStagedStore.getState().rules;
    if (!rulesMap[ruleId] || rulesMap[ruleId].isDeleted) {
      toast.error("This rule no longer exists in the current working set.");
      return;
    }
    router.push(`/rules?generalise=${ruleId}&from=diagnostics`);
  }

  return (
    <Button
      variant="outline"
      size="xs"
      onClick={handleClick}
      aria-label="Generalise this rule"
      title="Match the merchant rather than the exact strings"
    >
      <Wand2 className="h-3 w-3" />
      Generalise
    </Button>
  );
}

/**
 * Everything a bug report needs, in one action: which check fired and which
 * rules it fired on. The check's code is here rather than on the card because
 * this is the only place anybody wants it.
 */
function copyDiagnostics(finding: Finding): void {
  const ids = [
    ...finding.affected.map((r) => r.id),
    ...(finding.counterpart ? [finding.counterpart.id] : []),
  ];
  const payload = [finding.code, ...ids].join("\n");
  const ok = () => toast.success("Diagnostic details copied");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(payload).then(ok).catch(() => toast.error("Could not copy"));
  } else {
    toast.error("Clipboard is unavailable in this browser");
  }
}

/**
 * A finding as a card, in the order the questions arrive: what is wrong, how do
 * you know, and what can be done about it.
 *
 * The same anatomy Payee Cleanup settled on, because the two pages do the same
 * kind of job and should not have to be learned twice.
 */
export function FindingCard({
  finding,
  rulesById,
  onDismiss,
  onRestore,
  showRules = true,
  onOpenRule,
}: Props) {
  const counterpartLabel = COUNTERPART_LABEL[finding.code];
  const maps = useEntityMaps();
  const stageOf = (id: string) => rulesById.get(id)?.stage;
  const primaryStage = noteworthyStage(stageOf(finding.affected[0]?.id ?? ""));

  // Rule text is no longer truncated at 160 characters — the reader needs all
  // of it to decide. Long ones are clamped instead, and can be opened.
  //
  // Whether one *is* clamped is measured, not guessed. A character count cannot
  // know how the text wrapped: the same rule fits on a wide card and overflows
  // on a narrow one, and a guess that says "short enough" hides the end of a
  // rule with no way to reveal it.
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    // While expanded there is nothing to measure — the clamp is off, so
    // scrollHeight always equals clientHeight and the control would vanish
    // mid-read.
    if (!el || expanded) return;

    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, finding]);

  const canExpand = expanded || overflowing;

  return (
    <article
      className={`border-b border-l-2 border-border/50 px-4 py-2.5 ${SEVERITY_STRIPE[finding.severity]}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <Badge
          variant={SEVERITY_VARIANT[finding.severity]}
          aria-label={`Severity: ${SEVERITY_LABEL[finding.severity]}`}
        >
          {SEVERITY_LABEL[finding.severity]}
        </Badge>
        <h3 className="text-sm font-medium">{finding.title}</h3>
        {primaryStage && (
          <span
            className="rounded border border-border px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
            title={`This rule runs in the ${primaryStage} stage`}
          >
            {primaryStage}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {MERGEABLE_CODES.has(finding.code) && <MergeButton finding={finding} />}
          {finding.code === "RULE_OVERSPECIFIC_IMPORT_MATCH" && (
            <GeneraliseButton finding={finding} />
          )}
          {onDismiss && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onDismiss(finding)}
              aria-label={`Dismiss: ${finding.title}`}
              title="Stop reporting this - remembered for this budget, and reversible"
            >
              <CircleSlash className="h-3 w-3" />
              Not a problem
            </Button>
          )}
          {onRestore && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onRestore(finding)}
              aria-label={`Restore: ${finding.title}`}
              title="Start reporting this again"
            >
              <Undo2 className="h-3 w-3" />
              Restore
            </Button>
          )}
          {/* The check's own code used to sit on the card at full contrast.
              It belongs in a bug report, not in front of someone deciding
              what to do, so it rides along with the copy instead. */}
          <button
            type="button"
            onClick={() => copyDiagnostics(finding)}
            aria-label={`Copy diagnostic details for ${finding.title}`}
            title="Copy the check name and rule IDs"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Two columns, not three. The finding is what the reader came for and
          gets most of the width; the evidence and the payoff are what they
          check afterwards, so they share a narrower rail. "Worth fixing" was a
          peer column carrying per-code boilerplate — the same sentence on every
          duplicate group — which overstated it. */}
      <div className="mt-1.5 grid gap-x-6 gap-y-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          <h4 className={LABEL_CLASS}>
            {finding.affected.length > 1 ? `${finding.affected.length} rules` : "Rule"}
          </h4>
          <ul ref={listRef} className={expanded ? "mt-0.5" : "mt-0.5 line-clamp-6"}>
            {finding.affected.map((r, i) => (
              <RuleLine
                key={r.id}
                rule={r}
                // Numbered only when there are several, because two identical
                // duplicates otherwise read as one line rendered twice.
                index={finding.affected.length > 1 ? i + 1 : undefined}
                rulesById={rulesById}
                maps={maps}
                onOpenRule={onOpenRule}
              />
            ))}
          </ul>
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 rounded text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-expanded={expanded}
            >
              {expanded ? "Show less" : "Show the full rule"}
            </button>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-3">
          <section>
            <h4 className={LABEL_CLASS}>Evidence</h4>
            {/* Explanation first, then the proof. The explanation used to be
                dropped whenever a finding had a counterpart, which is exactly
                the shadowed case — so the card said a rule never fires and
                never said why. */}
            {finding.message && (
              <p className="mt-0.5 text-xs text-muted-foreground">{finding.message}</p>
            )}
            {finding.details && finding.details.length > 0 && (
              <ul className="mt-0.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
                {finding.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            {finding.counterpart && counterpartLabel && (
              <div className="mt-1.5">
                <span className={LABEL_CLASS}>{counterpartLabel}</span>
                <ul>
                  <RuleLine
                    rule={finding.counterpart}
                    rulesById={rulesById}
                    maps={maps}
                    onOpenRule={onOpenRule}
                  />
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>

    </article>
  );
}
