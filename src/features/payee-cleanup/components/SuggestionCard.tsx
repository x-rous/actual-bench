import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Star,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { annotateNoise, detectionSummary } from "../lib/triage";
import type { CleanupSuggestion } from "../lib/scan";
import type { ConfidenceBand } from "../lib/confidence";
import type { PayeeCleanupCandidate } from "../types";

type Props = {
  suggestion: CleanupSuggestion;
  addablePayees: PayeeCleanupCandidate[];
  onAccept: () => void;
  onReject: () => void;
  onExcludeMember: (payeeId: string) => void;
  onSetTarget: (payeeId: string) => void;
  onAddMember: (payeeId: string) => void;
  onRenameTo: (name: string) => void;
  onToggleRule: (enabled: boolean) => void;
  onRulePatternChange: (
    pattern: { field: "imported_payee" | "notes"; text: string } | undefined
  ) => void;
  onReset: () => void;
};

const BAND_LABEL: Record<ConfidenceBand, string> = {
  high: "High confidence",
  strong: "Likely",
  review: "Needs review",
  hidden: "Ambiguous",
};

/** Why no rule is being offered. One place, because two branches show it. */
const SKIP_COPY: Record<
  NonNullable<CleanupSuggestion["futureResolution"]>["skipReason"] & string,
  string
> = {
  "already-resolved-by-name":
    "No rule needed — after cleanup Actual will match these imports by name.",
  "existing-rule-covers-it":
    "No rule needed — an existing rule already sets the payee for this text.",
  "no-safe-pattern":
    "No rule offered — no pattern catches this payee without catching others.",
  "no-matching-pattern":
    "No rule offered — nothing in the imported text on record matches this pattern.",
};

const BAND_CLASS: Record<ConfidenceBand, string> = {
  high: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  strong: "border-sky-600/40 text-sky-700 dark:text-sky-400",
  review: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  hidden: "border-border text-muted-foreground",
};

/**
 * One cleanup suggestion, on one screen (RD-078 §11–§13; F-096).
 *
 * Three columns across the page width rather than a tall single column, so the
 * result, what changes, and the future-import rule are all readable at once and
 * the controls the user reaches for most — the final name, which payee survives,
 * and the rule's matched text — are editable in place. An earlier version put
 * these behind a modal drawer; opening a dialog per suggestion is worse than
 * scrolling, and it hid exactly the fields people adjust most often.
 *
 * **One payee list.** It carries the survivor choice, the per-payee transaction
 * counts and the remove control together. A separate "per payee" breakdown
 * elsewhere on the card was the same rows printed twice.
 *
 * Rarely-needed diagnostics — the confidence breakdown, related rules, the
 * pattern — sit behind an inline *reasoning* toggle, not a dialog.
 */
export function SuggestionCard({
  suggestion,
  addablePayees,
  onAccept,
  onReject,
  onExcludeMember,
  onSetTarget,
  onAddMember,
  onRenameTo,
  onToggleRule,
  onRulePatternChange,
  onReset,
}: Props) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [patternDraft, setPatternDraft] = useState<string | null>(null);
  // The chosen field is edit state, not a view of the detected one. Deriving it
  // from the recommended candidate meant a field the backtest could not
  // recommend — because the new pattern matched nothing — snapped back to
  // `imported_payee`, and the next blur committed that instead of the user's
  // choice.
  const [fieldOverride, setFieldOverride] = useState<
    "imported_payee" | "notes" | null
  >(null);
  // Fifty cards each rendering 200 <option> elements is 10,000 nodes nobody is
  // looking at, so the list is built when the picker is first focused.
  const [pickerOpen, setPickerOpen] = useState(false);

  const { cluster, confidence, target, canonicalName, correction, impact } = suggestion;
  const future = suggestion.futureResolution;
  const accepted = correction.decision === "accepted";
  const removals = cluster.evidence.map((e) => e.detail);
  const pattern = cluster.evidence.find((e) => e.pattern)?.pattern;

  const hasEdits =
    correction.excludedIds.length > 0 ||
    correction.addedIds.length > 0 ||
    correction.targetId !== undefined ||
    correction.canonicalName !== undefined ||
    correction.rulePattern !== undefined ||
    correction.decision !== "undecided";

  const settingsDiffer =
    impact?.behavior.favoriteDiffers === true ||
    impact?.behavior.learnCategoriesDiffers === true;
  const activeRules = impact ? impact.rules.regular + impact.rules.activeSchedule : 0;
  /**
   * The picker resolves the typed text back to a payee, so every option has to
   * be unique. Real budgets hold payees with identical names — the browser then
   * showed two identical rows and the lookup always returned the first, quietly
   * adding the wrong payee to the merge. Only the duplicated names carry the
   * disambiguating id, so the common case stays clean.
   */
  const addableOptions = useMemo(() => {
    const nameCounts = new Map<string, number>();
    for (const payee of addablePayees) {
      nameCounts.set(payee.name, (nameCounts.get(payee.name) ?? 0) + 1);
    }
    return addablePayees.map((payee) => ({
      id: payee.id,
      label:
        (nameCounts.get(payee.name) ?? 0) > 1
          ? `${payee.name} · ${payee.id.slice(0, 6)}`
          : payee.name,
    }));
  }, [addablePayees]);

  const ruleField =
    fieldOverride ??
    suggestion.correction.rulePattern?.field ??
    suggestion.futureResolution?.recommended?.candidate.field ??
    "imported_payee";

  const countFor = (id: string) =>
    impact?.members.find((m) => m.payeeId === id)?.transactionCount;

  /** A accept · R reasoning · N not duplicates, only when the card itself has focus. */
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "a") {
      event.preventDefault();
      onAccept();
    } else if (key === "r") {
      event.preventDefault();
      setShowReasoning((open) => !open);
    } else if (key === "n") {
      event.preventDefault();
      onReject();
    }
  }

  return (
    <article
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`${canonicalName} — ${BAND_LABEL[confidence.band]}`}
      className={cn(
        "rounded-md border p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        accepted ? "border-emerald-600/50 bg-emerald-500/5" : "border-border/70"
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{canonicalName}</h3>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium",
              BAND_CLASS[confidence.band]
            )}
          >
            {BAND_LABEL[confidence.band]}
          </span>
          <span className="text-xs text-muted-foreground">
            {cluster.members.length} payees
            <ArrowRight className="mx-1 inline size-3" aria-hidden="true" />1
          </span>
        </div>

        {/* Right-aligned, and Undo goes first: the group grows leftward when it
            appears, so Accept and Not duplicates never move under the cursor. */}
        <div className="flex items-center gap-2">
          {hasEdits ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // Local editor state too. Leaving `fieldOverride` set meant the
                // next text edit rebuilt a rule override on the field the user
                // had just undone.
                setFieldOverride(null);
                setPatternDraft(null);
                onReset();
              }}
            >
              <Undo2 className="size-3.5" aria-hidden="true" />
              Undo my changes
            </Button>
          ) : null}
          <Button size="sm" variant={accepted ? "default" : "outline"} onClick={onAccept}>
            <Check className="size-3.5" aria-hidden="true" />
            {accepted ? "Accepted" : "Accept"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onReject}>
            Not duplicates
          </Button>
        </div>
      </header>

      <div className="mt-3 grid gap-4 text-xs lg:grid-cols-3">
        {/* ── Result and the payees it comes from ───────────────────────── */}
        <section className="min-w-0">
          <h4 className="font-medium text-foreground">Result</h4>
          <input
            type="text"
            defaultValue={canonicalName}
            key={canonicalName}
            onBlur={(e) => {
              if (e.target.value !== canonicalName) onRenameTo(e.target.value);
            }}
            aria-label="Final payee name"
            className="mt-1 h-7 w-full rounded-md border border-border bg-background px-2 text-sm"
          />

          <ul className="mt-2 space-y-1" aria-label="Payees in this group">
            {cluster.members.map((member) => {
              const isTarget = member.id === target.targetId;
              return (
                <li key={member.id} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`keep-${cluster.id}`}
                    checked={isTarget}
                    onChange={() => onSetTarget(member.id)}
                    aria-label={`Keep ${member.name}`}
                    className="shrink-0"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      isTarget ? "text-foreground" : "text-muted-foreground"
                    )}
                    title={member.name}
                  >
                    {annotateNoise(member.name, removals).map((part, index) => (
                      <span
                        key={index}
                        className={part.noise ? "text-muted-foreground/40" : undefined}
                      >
                        {part.text}
                      </span>
                    ))}
                  </span>
                  {member.metadata.favorite ? (
                    <Star
                      className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-label="Favorite payee"
                    />
                  ) : null}
                  {/* Real budgets hold payees with identical names — the count
                      is what tells them apart. */}
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {countFor(member.id) ?? "—"} tx
                  </span>
                  {isTarget ? null : (
                    <button
                      type="button"
                      onClick={() => onExcludeMember(member.id)}
                      aria-label={`Remove ${member.name} from this group`}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <input
            type="text"
            list={`add-payee-${cluster.id}`}
            placeholder="Add a payee the scan missed…"
            aria-label="Add a payee the scan missed"
            className="mt-1.5 h-7 w-full rounded-md border border-dashed border-border bg-background px-2 text-xs"
            onFocus={() => setPickerOpen(true)}
            onChange={(e) => {
              const match = addableOptions.find(
                (o) => o.label === e.target.value
              );
              if (match) {
                onAddMember(match.id);
                e.target.value = "";
              }
            }}
          />
          <datalist id={`add-payee-${cluster.id}`}>
            {pickerOpen
              ? addableOptions.slice(0, 200).map((o) => (
                  <option key={o.id} value={o.label} />
                ))
              : null}
          </datalist>
        </section>

        {/* ── What changes ──────────────────────────────────────────────── */}
        <section className="min-w-0">
          <h4 className="font-medium text-foreground">What changes</h4>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            <li>
              {impact?.transactionTotal === undefined
                ? "Counting transactions…"
                : `${impact.transactionTotal.toLocaleString("en-US")} ${
                    impact.transactionTotal === 1 ? "transaction moves" : "transactions move"
                  } to the payee you keep`}
            </li>
            <li>
              {activeRules === 0
                ? "No rules reference these payees"
                : `${activeRules} ${activeRules === 1 ? "rule references" : "rules reference"} these payees — merging does not rewrite them`}
            </li>
            {impact && impact.rules.completedSchedule > 0 ? (
              <li>
                {impact.rules.completedSchedule} completed schedule
                {impact.rules.completedSchedule === 1 ? "" : "s"} — not counted as active
              </li>
            ) : null}
            <li
              className={
                settingsDiffer ? "text-amber-700 dark:text-amber-400" : undefined
              }
            >
              {settingsDiffer ? (
                <>
                  <AlertTriangle className="mr-1 inline size-3" aria-hidden="true" />
                  Favorite / Category learning differ — the payee you keep decides
                </>
              ) : (
                "Favorite and Category learning match"
              )}
            </li>
          </ul>

          <p className="mt-2 text-muted-foreground">{detectionSummary(suggestion)}</p>

          <button
            type="button"
            onClick={() => setShowReasoning((open) => !open)}
            aria-expanded={showReasoning}
            className="mt-1 inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {showReasoning ? (
              <ChevronDown className="size-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3" aria-hidden="true" />
            )}
            {showReasoning ? "Hide reasoning" : "Reasoning"}
          </button>

          {showReasoning ? (
            <div className="mt-1 space-y-1 text-muted-foreground">
              <p>{confidence.score}% — {confidence.reasons.map((r) => r.reason).join(" · ")}</p>
              <p>
                {target.reasons.length > 0
                  ? `Keeping this payee: ${target.reasons.join(" · ")}`
                  : "No clear signal favours any member — a stable default was chosen."}
              </p>
              {pattern ? (
                <code className="inline-block rounded bg-muted px-1 py-0.5 font-mono text-[11px] break-all">
                  {pattern}
                </code>
              ) : null}
              {future && future.relatedRules.length > 0 ? (
                <p>
                  {future.relatedRules.length} existing rule
                  {future.relatedRules.length === 1 ? "" : "s"} touch these payees
                  {future.relatedRules.some((r) => r.interaction === "potential-conflict")
                    ? " — at least one could conflict"
                    : ""}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* ── Future imports ────────────────────────────────────────────── */}
        <section className="min-w-0">
          <h4 className="font-medium text-foreground">Future imports</h4>

          {/* The editor stays once the user has overridden the field. Hiding it
              whenever there is no recommendation trapped them: picking a field
              with no historical matches removed the controls needed to pick
              another one, or to type text that would match. */}
          {future && (future.recommended || fieldOverride !== null) ? (
            <>
              {future.recommended ? (
                <label className="mt-1 flex items-start gap-2">
                  <Checkbox
                    checked={correction.createRule === true}
                    onCheckedChange={(value) => onToggleRule(value === true)}
                    aria-label="Create a rule so future imports match this payee"
                  />
                  <span className="text-foreground">
                    Create a rule to prevent this recurring
                  </span>
                </label>
              ) : (
                // `recommended` is null exactly when a skip reason is set, and
                // that reason is the accurate explanation: "an existing rule
                // already covers this" is not "nothing matches".
                <p className="mt-1 text-muted-foreground">
                  {future.skipReason
                    ? SKIP_COPY[future.skipReason]
                    : "Checking your import history…"}
                </p>
              )}

              <div className="mt-1.5 flex items-center gap-1.5">
                <select
                  value={ruleField}
                  onChange={(e) => {
                    const field = e.target.value as "imported_payee" | "notes";
                    setFieldOverride(field);
                    onRulePatternChange({
                      field,
                      text: patternDraft ?? future.matchText,
                    });
                  }}
                  aria-label="Which field the rule matches on"
                  className="h-7 rounded-md border border-border bg-background px-1"
                >
                  <option value="imported_payee">imported payee</option>
                  <option value="notes">notes</option>
                </select>
                <input
                  type="text"
                  value={patternDraft ?? future.matchText}
                  onChange={(e) => setPatternDraft(e.target.value)}
                  onBlur={() => {
                    if (patternDraft !== null && patternDraft !== future.matchText) {
                      onRulePatternChange(
                        patternDraft.trim()
                          ? { field: ruleField, text: patternDraft }
                          : undefined
                      );
                    }
                    setPatternDraft(null);
                  }}
                  aria-label="Text the rule should match"
                  className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2"
                />
              </div>

              {/* What will actually be created — one line, because "starts with
                  X" and a regex are not the same promise. */}
              {future.recommended ? (
              <>
              <code className="mt-1 block truncate rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                {future.recommended.candidate.field} {future.recommended.candidate.op}{" "}
                {future.recommended.candidate.value}
              </code>

              <p
                className={cn(
                  "mt-1",
                  future.recommended.unexpectedMatches > 0
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-muted-foreground"
                )}
              >
                {future.recommended.unexpectedMatches === 0 ? (
                  `Matches ${future.recommended.expectedMatches} of this group's past ${
                    future.recommended.expectedMatches === 1 ? "transaction" : "transactions"
                  }${
                    future.historyTruncated
                      ? " and nothing else in the history checked (only the most recent records were read)"
                      : " and nothing else"
                  }`
                ) : (
                  <>
                    <AlertTriangle className="mr-1 inline size-3" aria-hidden="true" />
                    {/* Both numbers, always: "also catches 1" alone gives no
                        sense of whether the rule is otherwise doing its job. */}
                    Matches {future.recommended.expectedMatches} of this group&apos;s past{" "}
                    {future.recommended.expectedMatches === 1 ? "transaction" : "transactions"},
                    and {future.recommended.unexpectedMatches}{" "}
                    {future.recommended.unexpectedMatches === 1 ? "transaction" : "transactions"} of{" "}
                    {future.recommended.unexpectedExamples
                      .map((e) => e.payeeName ?? e.text)
                      .slice(0, 2)
                      .join(", ")}
                    . Narrow the text, or add that payee to this group.
                  </>
                )}
              </p>
              </>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-muted-foreground">
              {future?.skipReason
                ? SKIP_COPY[future.skipReason]
                : "Checking your import history…"}
            </p>
          )}

        </section>
      </div>
    </article>
  );
}
