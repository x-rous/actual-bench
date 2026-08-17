"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { RuleGap } from "../lib/ruleGaps";

type Props = {
  gaps: RuleGap[];
  /** Payee ids the user has opted in to creating a rule for. */
  selected: Set<string>;
  onToggle: (payeeId: string, enabled: boolean) => void;
  onDismiss: (gap: RuleGap) => void;
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
export function RuleGapList({ gaps, selected, onToggle, onDismiss }: Props) {
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
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox
                  checked={selected.has(gap.payee.id)}
                  onCheckedChange={(value) => onToggle(gap.payee.id, value === true)}
                  aria-label={`Create a rule for ${gap.payee.name}`}
                />
                <span className="font-medium">{gap.payee.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {gap.transactionCount}{" "}
                  {gap.transactionCount === 1 ? "transaction" : "transactions"}
                </span>

                {extending ? (
                  // Worth saying out loud: this is the mechanism that stops a
                  // budget accumulating one rule per merchant.
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    adds to this payee&apos;s existing rule
                  </span>
                ) : null}

                {gap.safe ? null : (
                  <span className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-3" aria-hidden="true" />
                    needs a look
                  </span>
                )}

                <span className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
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
                  <Button size="sm" variant="ghost" onClick={() => onDismiss(gap)}>
                    Doesn&apos;t need one
                  </Button>
                </span>
              </div>

              <p className="mt-1 truncate text-xs text-muted-foreground">
                {proposal.shape === "one-of"
                  ? `when imported ${proposal.field === "notes" ? "notes" : "payee"} is ${proposal.texts
                      .map((t) => `"${t}"`)
                      .join(" or ")}`
                  : `when imported ${proposal.field === "notes" ? "notes" : "payee"} ${proposal.candidate.description}`}
                {" → set the payee"}
              </p>

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

                  {proposal.shape === "matches" ? (
                    <code
                      className={cn(
                        "inline-block rounded bg-muted px-1 py-0.5 font-mono text-[11px] break-all"
                      )}
                    >
                      {proposal.candidate.field} {proposal.candidate.op}{" "}
                      {proposal.candidate.value}
                    </code>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
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
