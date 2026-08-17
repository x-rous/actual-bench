"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { RuleGap, RuleGapOverride } from "../lib/ruleGaps";

type Props = {
  gaps: RuleGap[];
  /** Payee ids the user has opted in to creating a rule for. */
  selected: Set<string>;
  onToggle: (payeeId: string, enabled: boolean) => void;
  onDismiss: (gap: RuleGap) => void;
  onOverride: (payeeId: string, override: RuleGapOverride | undefined) => void;
};

/**
 * Payees the next import will not re-resolve (RD-087 §4).
 *
 * **Rows, not cards.** A cleanup suggestion is a three-column card because each
 * one is a judgement call with real blast radius — which payee survives, what it
 * ends up called, what happens to its transactions. These are one payee, one
 * rule, yes or no, and there are more of them. The detail that does exist sits
 * behind an expander rather than making every row tall.
 */
export function RuleGapList({
  gaps,
  selected,
  onToggle,
  onDismiss,
  onOverride,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (gaps.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
        Every payee will survive the next import. Nothing needs a rule.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* A tab that changes no payees, inside a page called Cleanup, is
          otherwise a surprise. */}
      <p className="text-xs text-muted-foreground">
        These payees are fine — their imports just aren&apos;t automated. Actual
        matches an imported payee <em>by name only</em>, so the next import of the
        original bank text would create a duplicate. Nothing here changes a payee.
      </p>

      <ul className="divide-y divide-border/40 rounded-md border border-border/70">
        {gaps.map((gap) => {
          const isOpen = expanded === gap.payee.id;
          const { proposal } = gap;
          const extending = proposal.extendsRule !== null;

          return (
            <li key={gap.payee.id} className="px-3 py-2 text-sm">
              {/* One line per payee. The condition sits on the row rather than
                  behind the expander — it is the thing worth checking before
                  ticking the box — and the boilerplate around it is gone: every
                  rule here sets the payee, so repeating that per row spent fifty
                  characters saying nothing. */}
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selected.has(gap.payee.id)}
                  onCheckedChange={(value) => onToggle(gap.payee.id, value === true)}
                  aria-label={`Create a rule for ${gap.payee.name}`}
                />
                <span className="max-w-[14rem] shrink-0 truncate font-medium">
                  {gap.payee.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {gap.transactionCount} tx
                </span>

                <span
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                  title={conditionText(proposal)}
                >
                  {proposal.field === "notes" ? "notes" : "imported payee"}{" "}
                  {proposal.shape === "one-of" ? (
                    proposal.texts.map((t) => `is "${t}"`).join(" or ")
                  ) : (
                    <>
                      {proposal.candidate.op}{" "}
                      <code className="rounded bg-muted px-1 font-mono text-[11px]">
                        {proposal.candidate.value}
                      </code>
                    </>
                  )}
                </span>

                {/* Badges left of the actions, never between them and the edge:
                    they vary in width, and buttons that move from row to row
                    cannot be clicked down a list without re-aiming each time. */}
                {extending ? (
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    extends existing
                  </span>
                ) : null}

                {gap.existingRules.length > 0 ? (
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {gap.existingRules.length === 1
                      ? "has a rule"
                      : `has ${gap.existingRules.length} rules`}
                  </span>
                ) : null}

                {/* Keeps its colour and icon. It is the one thing on the row
                    saying "do not accept this without looking", and it should
                    not read like the informational chips beside it. */}
                {gap.safe ? null : (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-3" aria-hidden="true" />
                    needs a look
                  </span>
                )}

                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setExpanded(isOpen ? null : gap.payee.id)}
                    aria-expanded={isOpen}
                    aria-label={`Details for ${gap.payee.name}`}
                  >
                    {isOpen ? (
                      <ChevronDown className="size-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="size-3.5" aria-hidden="true" />
                    )}
                    Details
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onDismiss(gap)}>
                    Not needed
                  </Button>
                </span>
              </div>

              {isOpen ? (
                <div className="mt-2 space-y-2 border-l-2 border-border/60 pl-3 text-xs">
                  {gap.cautions.length > 0 ? (
                    <ul className="space-y-1 text-amber-700 dark:text-amber-400">
                      {gap.cautions.map((caution) => (
                        <li key={caution}>{caution}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-emerald-700 dark:text-emerald-400">
                      {proposal.shape === "one-of"
                        ? "Matches this exact text and nothing else in your budget."
                        : `Matches ${proposal.score.expectedMatches} of this payee's past transactions and nothing else.`}
                    </p>
                  )}

                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Imports on record
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {gap.texts.slice(0, 6).map((row) => (
                        <li
                          key={`${row.field}-${row.text}`}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="min-w-0 truncate font-mono text-[11px]">
                            {row.text}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {row.transactionCount}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {gap.texts.length > 6 ? (
                      <p className="mt-1 text-muted-foreground">
                        and {gap.texts.length - 6} more
                      </p>
                    ) : null}
                  </div>

                  {gap.existingRules.length > 0 ? (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Rules that already set this payee
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {gap.existingRules.map(({ rule, covered, total, fullyChecked }) => (
                          <li key={rule.id} className="flex items-center gap-2">
                            <Link
                              href={`/rules?highlight=${rule.id}`}
                              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                              aria-label={`Open the existing rule for ${gap.payee.name}`}
                            >
                              {describeConditions(rule)}
                              <ExternalLink className="size-3" aria-hidden="true" />
                            </Link>
                            <span className="shrink-0 text-muted-foreground">
                              catches {covered} of {total}
                              {fullyChecked ? "" : " (plus conditions not checked here)"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <RuleConditionEditor gap={gap} onOverride={onOverride} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The condition as plain text, for the row's hover title when it truncates. */
function conditionText(proposal: RuleGap["proposal"]): string {
  const field = proposal.field === "notes" ? "notes" : "imported payee";
  return proposal.shape === "one-of"
    ? `${field} ${proposal.texts.map((t) => `is "${t}"`).join(" or ")}`
    : `${field} ${proposal.candidate.op} ${proposal.candidate.value}`;
}

/** A rule's conditions in the same words the rest of the tab uses. */
function describeConditions(rule: RuleGap["existingRules"][number]["rule"]): string {
  const parts = rule.conditions.map((c) => {
    const value = Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? "");
    const field = c.field === "imported_payee" ? "imported payee" : c.field;
    return `${field} ${c.op} ${value}`;
  });
  return parts.length > 0 ? parts.join(rule.conditionsOp === "or" ? " or " : " and ") : "this rule";
}

/**
 * Editing the condition by hand.
 *
 * Two ops only: `matches` for a pattern, `contains` for plain text. Actual also
 * supports `oneOf`, and the scan still proposes it for text that never varies —
 * but as an *edit* it has no purpose, since anyone typing a condition is trying
 * to catch something they have not seen yet.
 *
 * The controls stay live whatever the pattern does, including when it matches
 * nothing: hiding them at that point would remove the only way to fix it.
 */
function RuleConditionEditor({
  gap,
  onOverride,
}: {
  gap: RuleGap;
  onOverride: (payeeId: string, override: RuleGapOverride | undefined) => void;
}) {
  const { proposal } = gap;
  const currentValue =
    proposal.shape === "matches"
      ? proposal.candidate.value
      : proposal.texts.map((t) => t).join(" ");
  const currentOp: "matches" | "contains" =
    proposal.shape === "matches" ? proposal.candidate.op : "contains";
  const edited = proposal.shape === "matches" && proposal.edited === true;

  const [draft, setDraft] = useState<string | null>(null);

  const commit = (value: string, op: "matches" | "contains", field: RuleGapOverride["field"]) => {
    if (!value.trim()) {
      onOverride(gap.payee.id, undefined);
      return;
    }
    onOverride(gap.payee.id, { field, op, value });
  };

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Condition
      </div>
      <div
        role="group"
        aria-label={`Rule condition for ${gap.payee.name}`}
        className="flex flex-wrap items-center gap-1.5"
      >
        <select
          value={proposal.field}
          onChange={(e) =>
            commit(
              draft ?? currentValue,
              currentOp,
              e.target.value as RuleGapOverride["field"]
            )
          }
          aria-label={`Which field the rule for ${gap.payee.name} matches on`}
          className="h-7 rounded-md border border-border bg-background px-1"
        >
          <option value="imported_payee">imported payee</option>
          <option value="notes">notes</option>
        </select>

        <select
          value={currentOp}
          onChange={(e) =>
            commit(
              draft ?? currentValue,
              e.target.value as "matches" | "contains",
              proposal.field
            )
          }
          aria-label={`How the rule for ${gap.payee.name} matches`}
          className="h-7 rounded-md border border-border bg-background px-1"
        >
          <option value="matches">matches</option>
          <option value="contains">contains</option>
        </select>

        <input
          type="text"
          value={draft ?? currentValue}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null && draft !== currentValue) {
              commit(draft, currentOp, proposal.field);
            }
            setDraft(null);
          }}
          aria-label={`Text the rule for ${gap.payee.name} should match`}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono"
        />

        {edited ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(null);
              onOverride(gap.payee.id, undefined);
            }}
          >
            Undo my changes
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The bulk action, mirroring "Accept n safe" on the suggestions tab. */
export function CreateSafeRulesButton({
  safeCount,
  onCreate,
}: {
  safeCount: number;
  onCreate: () => void;
}) {
  if (safeCount === 0) return null;
  return (
    <Button size="sm" variant="outline" onClick={onCreate}>
      <Plus className="size-3.5" aria-hidden="true" />
      Create {safeCount} safe {safeCount === 1 ? "rule" : "rules"}
    </Button>
  );
}
