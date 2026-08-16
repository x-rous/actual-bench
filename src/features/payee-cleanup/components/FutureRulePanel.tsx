import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { FutureResolution, SourceField } from "../lib/ruleCandidates";

type Props = {
  resolution: FutureResolution;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  /** Replaces the generated pattern; clearing the text restores it. */
  onPatternChange: (pattern: { field: SourceField; text: string } | undefined) => void;
};

const SKIP_COPY: Record<NonNullable<FutureResolution["skipReason"]>, string> = {
  "already-resolved-by-name":
    "No rule needed — after cleanup, Actual will match these imports to the payee by name on its own.",
  "existing-rule-covers-it":
    "No rule needed — one of your existing rules already sets the payee for this text.",
  "no-safe-pattern":
    "No rule offered — no pattern catches this payee without also catching other payees' transactions.",
  "no-matching-pattern":
    "No rule offered — no pattern built from this name matches the imported text on record.",
};

/**
 * The "stop this happening again" step (RD-078 §15–§17).
 *
 * Most of this panel's job is *not* proposing a rule. Actual already resolves an
 * imported name that exactly matches an existing payee, and an existing rule may
 * already do the work — so cleanup often fixes future imports with no rule at
 * all, and adding one anyway is the rule sprawl this feature exists to undo.
 */
export function FutureRulePanel({
  resolution,
  enabled,
  onToggle,
  onPatternChange,
}: Props) {
  const { recommended, skipReason, exactName, relatedRules, candidates } = resolution;
  const [draft, setDraft] = useState<string | null>(null);
  // Edit state, not a view of the detected field: a field whose pattern the
  // backtest cannot recommend produced no candidate, so the select snapped back
  // to `imported_payee` and the next blur committed that over the user's choice.
  const [fieldOverride, setFieldOverride] = useState<SourceField | null>(null);
  const field: SourceField =
    fieldOverride ?? recommended?.candidate.field ?? "imported_payee";

  return (
    <section className="mt-3 border-t border-border/60 pt-3 text-xs">
      <h4 className="font-medium text-foreground">Future imports</h4>

      {exactName.covered > 0 ? (
        <p className="mt-1 text-muted-foreground">
          {exactName.covered} past import{exactName.covered === 1 ? "" : "s"}{" "}
          already match the name you are keeping, so {exactName.covered === 1 ? "it" : "they"} will
          resolve without a rule.
        </p>
      ) : null}

      {relatedRules.length > 0 ? (
        <p className="mt-1 text-muted-foreground">
          {relatedRules.length} existing rule{relatedRules.length === 1 ? "" : "s"} already
          touch{relatedRules.length === 1 ? "es" : ""} these payees
          {relatedRules.some((r) => r.interaction === "potential-conflict")
            ? " — at least one could conflict with a new rule."
            : "."}
        </p>
      ) : null}

      {skipReason ? (
        <p className="mt-1 text-muted-foreground">{SKIP_COPY[skipReason]}</p>
      ) : null}

      {/* The editor survives an override that finds nothing. Hiding it whenever
          there is no recommendation trapped the user: choosing a field with no
          historical matches removed the very controls needed to choose another
          one, or to type text that would match. */}
      {recommended || fieldOverride !== null ? (
        <div className="mt-2 space-y-1">
          {recommended ? (
          <label className="flex items-start gap-2">
            <Checkbox
              checked={enabled}
              onCheckedChange={(value) => onToggle(value === true)}
              aria-label="Also create a rule so future imports match this payee"
            />
            <span>
              <span className="text-foreground">
                Also create a rule: when{" "}
                {recommended.candidate.field === "notes" ? "notes" : "imported payee"}{" "}
                {recommended.candidate.description}, set the payee.
              </span>
              <span className="ml-1 block text-muted-foreground">
                Matches {recommended.expectedMatches} past transaction
                {recommended.expectedMatches === 1 ? "" : "s"} of this payee
                {recommended.unexpectedMatches === 0
                  ? " and nothing else."
                  : ` — and ${recommended.unexpectedMatches} belonging to other payees.`}
              </span>
            </span>
          </label>

          ) : (
            <p className="text-amber-700 dark:text-amber-400">
              No pattern on this field matches your import history. Change the
              field or the text below, or leave the rule off.
            </p>
          )}

          {recommended && recommended.unexpectedMatches > 0 ? (
            <p className="ml-6 text-amber-700 dark:text-amber-400">
              Not selected for you, because it would also catch{" "}
              {recommended.unexpectedExamples
                .map((e) => (e.payeeName ? `"${e.text}" (${e.payeeName})` : `"${e.text}"`))
                .join(", ")}
            </p>
          ) : null}

          <div className="ml-6 space-y-1">
            {/* A group, not a label: one <label> can only name one control, and
                this row holds a select and an input. Both carry their own
                aria-label. */}
            <div
              role="group"
              aria-label="Rule pattern"
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-muted-foreground">Match on</span>
              <select
                value={field}
                onChange={(e) => {
                  const next = e.target.value as SourceField;
                  setFieldOverride(next);
                  onPatternChange({
                    field: next,
                    text: draft ?? resolution.matchText,
                  });
                }}
                className="h-7 rounded-md border border-border bg-background px-1 text-xs"
                aria-label="Which field the rule matches on"
              >
                <option value="imported_payee">imported payee</option>
                <option value="notes">notes</option>
              </select>
              <span className="text-muted-foreground">text</span>
              <input
                type="text"
                value={draft ?? resolution.matchText}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (draft !== null && draft !== resolution.matchText) {
                    onPatternChange(draft.trim() ? { field, text: draft } : undefined);
                  }
                  setDraft(null);
                }}
                className="h-7 min-w-[12rem] rounded-md border border-border bg-background px-2 text-xs"
                aria-label="Text the rule should match"
              />
            </div>

            {recommended ? (
              <code className="inline-block rounded bg-muted px-1 py-0.5 font-mono text-[11px] break-all">
                {recommended.candidate.field} {recommended.candidate.op}{" "}
                {recommended.candidate.value}
              </code>
            ) : null}

            {recommended && candidates.length > 1 ? (
              <p className="text-muted-foreground">
                {candidates.length - 1} other pattern
                {candidates.length === 2 ? "" : "s"} considered
                {recommended.unexpectedMatches === 0
                  ? "; this one caught the most of this payee's history without catching anything else."
                  : "; none caught this payee without also catching others — edit the text above to narrow it."}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
