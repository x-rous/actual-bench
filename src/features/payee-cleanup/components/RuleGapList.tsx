"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ConditionChip } from "@/features/rules/components/RuleChips";
import type { EntityMaps } from "@/features/rules/utils/rulePreview";
import { useStagedStore } from "@/store/staged";
import { useProposalBacktest } from "../hooks/useProposalBacktest";
import type { RuleGap, RuleGapOverride } from "../lib/ruleGaps";

type Props = {
  gaps: RuleGap[];
  /** Payee ids the user has accepted a rule for. Staged on save, not before. */
  accepted: Set<string>;
  onAccept: (payeeId: string, next: boolean) => void;
  onDismiss: (gap: RuleGap) => void;
  /** Opens an existing rule for editing without leaving the tab. */
  onOpenRule: (ruleId: string) => void;
  onOverride: (payeeId: string, override: RuleGapOverride | undefined) => void;
  /** True while the import history is still being read. */
  loading: boolean;
  /** True when a search is hiding rows that do exist. */
  filtered: boolean;
};

/**
 * The entity graph the rule chips resolve ids against.
 *
 * Same selectors the Rules page uses, so a rule cannot render differently in the
 * two places.
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

/** A rule's conditions as plain text, for an accessible name or a title. */
function describeConditions(rule: RuleGap["existingRules"][number]["rule"]): string {
  const parts = rule.conditions.map((c) => {
    const value = Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? "");
    const field = c.field === "imported_payee" ? "imported payee" : c.field;
    return `${field} ${c.op} ${value}`;
  });
  return parts.length > 0 ? parts.join(rule.conditionsOp === "or" ? " or " : " and ") : "this rule";
}

/**
 * An existing rule's conditions, rendered by the Rules page's own component.
 *
 * Not a copy of it. The first version here re-implemented the chips, and got the
 * hard parts wrong exactly where a hand-rolled version does: an entity-valued
 * condition printed a raw uuid instead of the account's name, and an amount
 * range printed "[object Object]". `ConditionChip` already resolves ids through
 * the staged entity maps and formats every value type, so the rules shown beside
 * a proposal now read the same as the rules on the page they came from.
 */
function ExistingRuleChips({ rule }: { rule: RuleGap["existingRules"][number]["rule"] }) {
  const maps = useEntityMaps();
  const joiner = rule.conditionsOp === "or" ? "or" : "and";

  if (rule.conditions.length === 0) {
    return <span className="text-muted-foreground">this rule</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {rule.conditions.map((condition, index) => (
        <span key={`${condition.field}-${index}`} className="flex items-center gap-1">
          {index > 0 ? (
            <span className="text-[11px] text-muted-foreground">{joiner}</span>
          ) : null}
          <ConditionChip condition={condition} maps={maps} />
        </span>
      ))}
    </span>
  );
}

/**
 * A matched payee, with the import text behind the match.
 *
 * One text per line. Joined with a separator they read as a single long string,
 * which is exactly what they are not - they are distinct imports, and telling
 * them apart is the point of showing them at all.
 */
function MatchTexts({ name, texts }: { name: string; texts: string[] }) {
  return (
    <span className="min-w-0">
      <span className="block">{name}</span>
      {texts.slice(0, 3).map((text) => (
        <span key={text} className="block truncate font-mono text-[11px] text-muted-foreground">
          {text}
        </span>
      ))}
      {texts.length > 3 ? (
        <span className="block text-[11px] text-muted-foreground">
          and {texts.length - 3} more
        </span>
      ) : null}
    </span>
  );
}

/**
 * The whole-budget check, run on request.
 *
 * The scan's row cap is a promise it cannot keep for a large budget: unexpected
 * matches are only counted over strings that were read, so beyond the cap the
 * row hedges ("may catch more than is shown") rather than lie. Reading more of
 * the budget on arrival would make every visit slow to answer a question about
 * one row, so the answer is offered here instead, for the row being looked at.
 *
 * It asks the budget to evaluate the condition rather than fetching history to
 * evaluate it locally, so the cost is the size of the *answer*, not the size of
 * the budget - and it is exact, which is the part the caution could not be.
 */
function ProposalFullCheck({ gap }: { gap: RuleGap }) {
  const [asked, setAsked] = useState(false);
  const { data, isFetching, error, retry } = useProposalBacktest(gap.payee, gap.proposal, {
    enabled: asked,
  });

  if (!asked) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setAsked(true)}>
          <Search className="size-3.5" aria-hidden="true" />
          Check the whole budget
        </Button>
        <span className="text-muted-foreground">
          Counts every transaction this condition matches, not just the ones the
          initial scan read.
        </span>
      </div>
    );
  }

  if (isFetching) {
    return <p className="text-muted-foreground">Checking every transaction…</p>;
  }

  if (error || !data) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-destructive">The check could not be run.</p>
        {/* Re-runs the query. Clearing `asked` only put the button back, so
            "Try again" took two clicks to do what it said. */}
        <Button size="sm" variant="ghost" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Checked against every transaction
      </div>
      {/* "and no other payee's" is a claim about everything the query did not
          return, so it is only made on a complete read. At the limit this check
          would otherwise become the same unearned promise the capped scan was
          careful not to make. */}
      <p
        className={
          data.others.length === 0 && !data.truncated
            ? "text-emerald-700 dark:text-emerald-400"
            : ""
        }
      >
        {`Matches ${data.expected.toLocaleString("en-US")} of this payee's ${
          data.expected === 1 ? "transaction" : "transactions"
        }${
          data.others.length === 0 && !data.truncated
            ? ", and no other payee's transactions."
            : "."
        }`}
      </p>
      {data.truncated ? (
        <p className="text-amber-700 dark:text-amber-400">
          This condition matches more distinct import texts than the check reads
          at once, so what follows is a sample rather than the whole picture.
          Narrowing the condition will make it exact.
        </p>
      ) : null}

      {data.others.length > 0 ? (
        <>
          {/* Named, not counted. "Also catches 12 transactions" is a number to
              worry about; naming the payees is a decision the user can make. */}
          <p className="text-amber-700 dark:text-amber-400">
            It would also catch transactions belonging to{" "}
            {data.others.length === 1 ? "another payee" : `${data.others.length} other payees`}:
          </p>
          <ul className="space-y-1.5">
            {data.others.slice(0, 6).map((match) => (
              <li key={match.payeeId ?? "none"} className="flex items-baseline gap-2">
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                  {match.transactionCount.toLocaleString("en-US")}
                </span>
                <MatchTexts name={match.payeeName ?? "(unnamed payee)"} texts={match.texts} />
              </li>
            ))}
          </ul>
          {data.others.length > 6 ? (
            <p className="text-muted-foreground">and {data.others.length - 6} more</p>
          ) : null}
        </>
      ) : null}

      {/* Separate from the collisions above, and not amber. A transaction with
          no payee is not being taken from anyone - setting one on it is the
          whole point of the rule. */}
      {data.unassigned ? (
        <div className="space-y-1">
          <p className="text-muted-foreground">
            {`It would also set this payee on ${data.unassigned.transactionCount.toLocaleString(
              "en-US"
            )} ${
              data.unassigned.transactionCount === 1 ? "transaction" : "transactions"
            } that have no payee yet:`}
          </p>
          <ul className="space-y-0.5">
            {data.unassigned.texts.slice(0, 4).map((text) => (
              <li key={text} className="truncate font-mono text-[11px] text-muted-foreground">
                {text}
              </li>
            ))}
          </ul>
          {data.unassigned.texts.length > 4 ? (
            <p className="text-muted-foreground">and {data.unassigned.texts.length - 4} more</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Which column orders the list. */
type SortKey = "history" | "name";

/**
 * A column header that also sorts.
 *
 * The list is a `ul` rather than a table, so there is no header cell to carry
 * `aria-sort`. The button reports its own state with `aria-pressed`, which tells
 * a screen reader which ordering is active rather than leaving it to an arrow
 * only sighted users can see.
 */
function SortHeader({
  label,
  active,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1 text-left uppercase tracking-wider hover:text-foreground",
        active ? "text-foreground" : "",
        className
      )}
    >
      {label}
      <ArrowDown
        className={cn("size-3 transition-opacity", active ? "opacity-100" : "opacity-0")}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * The row's fixed cells.
 *
 * Shared with the header so the two cannot drift. Fixed rather than fluid: the
 * point of a column is that the next row's value starts at the same place, and
 * a name-sized-to-content layout put every condition at a different x.
 */
const COLUMN = {
  name: "w-52 shrink-0 truncate font-medium",
  count: "w-28 shrink-0 text-xs tabular-nums text-muted-foreground",
} as const;

/**
 * Payees the next import will not re-resolve (RD-087 §4).
 *
 * **Rows, not cards.** A cleanup suggestion is a three-column card because each
 * one is a judgement call with real blast radius — which payee survives, what it
 * ends up called, what happens to its transactions. These are one payee, one
 * rule, yes or no, and there are more of them. The detail that does exist sits
 * behind an expander rather than making every row tall.
 *
 * **A checkbox that says what it did.** The tick sits beside the payee name,
 * where the decision is actually made: a button at the far right of a wide row
 * asks the eye to travel back to act on what it just read. What a checkbox alone
 * could not say is that ticking is a decision rather than a filter, so a ticked
 * row also carries an **Accepted** badge - the tick is the control, the badge is
 * the state. Nothing is written until save, on either tab.
 *
 * **Columns, not a sentence.** Name, count and condition are fixed-width cells
 * so the eye can run down any one of them. A row used to be a run-on line whose
 * condition began at a different x-position on every row.
 */
export function RuleGapList({
  gaps,
  accepted,
  onAccept,
  onDismiss,
  onOpenRule,
  onOverride,
  loading,
  filtered,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  /*
   * Most-used first by default.
   *
   * A rule on a payee with 300 transactions is worth more than one on a payee
   * with 3, and the list is long enough that the difference decides where to
   * start. Name order is offered for finding a payee rather than ranking one.
   */
  const [sort, setSort] = useState<SortKey>("history");

  const ordered = useMemo(() => {
    const rows = [...gaps];
    if (sort === "name") {
      return rows.sort((a, b) => a.payee.name.localeCompare(b.payee.name));
    }
    return rows.sort((a, b) => b.transactionCount - a.transactionCount);
  }, [gaps, sort]);

  if (gaps.length === 0) {
    // Three different reasons, and only one of them is good news. Saying every
    // payee will survive while the history is still loading, or while a search
    // is hiding the rows, is a claim the tab has not earned.
    return (
      <p className="rounded-md border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
        {loading
          ? "Reading your import history…"
          : filtered
            ? "No payees needing a rule match this search."
            : "Every payee will survive the next import. Nothing needs a rule."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* A tab that changes no payees, inside a page called Cleanup, is
          otherwise a surprise. */}
      <p className="text-xs text-muted-foreground">
        These payees are fine - their imports just aren&apos;t automated. Actual
        matches an imported payee <em>by name only</em>, so the next import of the
        original bank text would create a duplicate. Nothing here changes a payee.
      </p>

      <div className="overflow-hidden rounded-md border border-border/70">
        {/* Names the columns, so a bare payee-then-number-then-chips row stops
            being something the reader has to decode on the first row. */}
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {/* Matches the checkbox's footprint so the labels sit over their
              columns rather than one cell to the left. */}
          <span className="w-4 shrink-0" aria-hidden="true" />
          <SortHeader
            className="w-52 shrink-0"
            label="Payee"
            active={sort === "name"}
            onClick={() => setSort("name")}
          />
          <SortHeader
            className="w-28 shrink-0"
            label="History"
            active={sort === "history"}
            onClick={() => setSort("history")}
          />
          <span className="min-w-0 flex-1">Rule that would be created</span>
        </div>

        <ul className="divide-y divide-border/40">
        {ordered.map((gap) => {
          const isOpen = expanded === gap.payee.id;
          const { proposal } = gap;
          const extending = proposal.extendsRule !== null;
          const textTransactions = gap.texts.reduce(
            (sum, row) => sum + row.transactionCount,
            0
          );
          const isAccepted = accepted.has(gap.payee.id);
          // The one sentence that decides a row, on the row. Collapsed, this
          // list used to show only the negative case, so the safe majority had
          // to open an expander to be told there was nothing to see.
          const verdict = gap.cautions[0] ?? safeVerdict(gap);
          // The proposed rule's own field first: those are the rows it can
          // actually match, and the others are context.
          const orderedTexts = [...gap.texts].sort((a, b) => {
            const aOn = a.field === gap.proposal.field ? 0 : 1;
            const bOn = b.field === gap.proposal.field ? 0 : 1;
            return aOn - bOn || b.transactionCount - a.transactionCount;
          });

          return (
            <li key={gap.payee.id} className="px-3 py-2 text-sm">
              {/* The condition sits on the row rather than behind the expander:
                  it is the thing worth checking before accepting, and the
                  boilerplate around it is gone - every rule here sets the payee,
                  so repeating that per row spent fifty characters saying
                  nothing. */}
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={isAccepted}
                  onCheckedChange={(value) => onAccept(gap.payee.id, value === true)}
                  aria-label={`Accept a rule for ${gap.payee.name}`}
                />
                <span className={COLUMN.name} title={gap.payee.name}>
                  {gap.payee.name}
                </span>
                <span className={COLUMN.count}>
                  {gap.transactionCount.toLocaleString("en-US")} transactions
                </span>

                <span className="min-w-0 flex-1 truncate" title={conditionText(proposal)}>
                  <RuleConditionChip proposal={proposal} />
                </span>

                {/* The tick is the control; this says what the tick meant. A
                    checkbox alone reads as a filter. */}
                {isAccepted ? (
                  <span className="shrink-0 rounded-full border border-emerald-600/40 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                    Accepted
                  </span>
                ) : null}

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
                  {/* Named per row, as Details is: a list of buttons all
                      reading "Not needed" tells a screen-reader user nothing
                      about which payee each one dismisses. The visible text
                      stays inside the accessible name, so voice control still
                      reaches it. */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDismiss(gap)}
                    aria-label={`Not needed for ${gap.payee.name}`}
                  >
                    Not needed
                  </Button>
                </span>
              </div>

              {/* Second line rather than a fourth column: the condition above is
                  already the only flexible cell and already truncates. */}
              <p
                className={cn(
                  "mt-0.5 truncate pl-0.5 text-[11px]",
                  gap.safe
                    ? "text-muted-foreground"
                    : "text-amber-700 dark:text-amber-400"
                )}
                title={gap.cautions.join(" ") || verdict}
              >
                {verdict}
                {gap.cautions.length > 1
                  ? ` +${gap.cautions.length - 1} more in Details`
                  : null}
              </p>

              {isOpen ? (
                <div className="mt-2 space-y-2 border-l-2 border-border/60 pl-3 text-xs">
                  {/* Only what the row could not fit. The first caution, and
                      the safe verdict, are already on the row above - repeating
                      them here made opening the details look like it had failed
                      to load anything new. */}
                  {gap.cautions.length > 1 ? (
                    <ul className="space-y-1 text-amber-700 dark:text-amber-400">
                      {gap.cautions.slice(1).map((caution) => (
                        <li key={caution}>{caution}</li>
                      ))}
                    </ul>
                  ) : null}

                  {/*
                    Evidence left, rule right, side by side.
                    Editing a condition means aiming it at the strings it has to
                    match, and those were stacked far enough apart that checking
                    your pattern against them meant scrolling away from the field
                    you were typing in. Stacks again below `md`, where two
                    columns would leave neither readable.
                  */}
                  <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                    <div className="min-w-0 space-y-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          Imports on record
                        </div>
                        {/* The row counts the payee's transactions; this list counts
                            the ones whose text was read before the history cap. When
                            they differ the gap is a fact about the read, not a bug. */}
                        {textTransactions < gap.transactionCount ? (
                          <p className="text-muted-foreground">
                            {textTransactions} of {gap.transactionCount} transactions have
                            import text that was read.
                          </p>
                        ) : null}
                        {/* The count leads, in its own narrow column. Pushed to the
                            far right it sat a variable distance from the text it
                            counted, so reading the pair meant crossing the gap on
                            every line. */}
                        {/* Each row says which field it came from, and rows on
                            the proposed rule's field come first.
                            The list holds both `imported payee` and `notes` and
                            used to label neither, sitting directly under a
                            condition naming one of them: a payee whose history
                            is in its notes showed a screen of text that plainly
                            contained the pattern, under a rule that matched two
                            of them. The evidence has to say what it is evidence
                            for. */}
                        <ul className="mt-1 space-y-0.5">
                          {orderedTexts.slice(0, 6).map((row) => (
                            <li
                              key={`${row.field}-${row.text}`}
                              className="flex items-baseline gap-2"
                            >
                              <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                                {row.transactionCount.toLocaleString("en-US")}
                              </span>
                              <span
                                className={cn(
                                  "w-24 shrink-0 rounded px-1 text-[10px]",
                                  row.field === gap.proposal.field
                                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400"
                                    : "text-muted-foreground"
                                )}
                              >
                                {row.field === "notes" ? "notes" : "imported payee"}
                              </span>
                              <span className="min-w-0 truncate font-mono text-[11px]">
                                {row.text}
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

                      <ProposalFullCheck gap={gap} />
                    </div>

                    <div className="min-w-0 space-y-3">
                      <RuleConditionEditor gap={gap} onOverride={onOverride} />

                      {gap.existingRules.length > 0 ? (
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            Rules that already set this payee
                          </div>
                          {/* An existing rule is shown in the same colours as the
                              proposed one above it, and as the Rules page it opens:
                              the comparison the user is making is between two
                              rules, so they should not be drawn in two schemes. */}
                          <ul className="mt-1 space-y-1">
                            {gap.existingRules.map(({ rule, covered, total, fullyChecked }) => (
                              <li key={rule.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                {/* Opens here rather than navigating to the Rules
                                    page: judging a rule against this payee's import
                                    text is the task, and leaving the page to do it
                                    loses the evidence beside it. */}
                                <button
                                  type="button"
                                  onClick={() => onOpenRule(rule.id)}
                                  className="inline-flex min-w-0 items-center gap-1 rounded text-left hover:bg-muted/60"
                                  aria-label={`Edit the rule ${describeConditions(rule)}`}
                                >
                                  <ExistingRuleChips rule={rule} />
                                  <Pencil
                                    className="size-3 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                </button>
                                <span className="shrink-0 text-muted-foreground">
                                  catches {covered} of {total}
                                  {fullyChecked ? "" : " (plus conditions not checked here)"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
        </ul>
      </div>
    </div>
  );
}


/**
 * The proposed condition, in the Rules page's vocabulary.
 *
 * Field indigo, operator muted, value emerald - the same encoding `ConditionChip`
 * uses on the Rules page and in the rule editor. A user who has read a rule
 * anywhere else in Bench can read this one without being taught a second scheme,
 * which matters because this tab's whole output is rules.
 */
function RuleConditionChip({ proposal }: { proposal: RuleGap["proposal"] }) {
  const field = proposal.field === "notes" ? "notes" : "imported payee";
  const op = proposal.shape === "one-of" ? "is" : proposal.candidate.op;
  const values = proposal.shape === "one-of" ? proposal.texts : [proposal.candidate.value];

  return (
    <span className="flex items-center gap-1 overflow-hidden">
      <span className="shrink-0 rounded bg-indigo-50 px-1 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400">
        {field}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{op}</span>
      {values.map((value, index) => (
        <span
          key={value}
          className="truncate rounded bg-emerald-50 px-1 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
        >
          {value}
          {index < values.length - 1 ? (
            <span className="ml-0.5 text-emerald-500">,</span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/**
 * What a safe row is asserting, in one line.
 *
 * The same claim the expander made, hoisted onto the row: this is the whole
 * decision when there is no caution, and it was the thing behind the click.
 */
function safeVerdict(gap: RuleGap): string {
  const { proposal } = gap;
  if (proposal.shape === "one-of") {
    return "Matches this payee's import text exactly.";
  }
  const { expectedMatches } = proposal.score;
  return `Matches ${expectedMatches.toLocaleString("en-US")} of this payee's ${
    expectedMatches === 1 ? "transaction" : "transactions"
  }.`;
}

/** The condition as plain text, for the row's hover title when it truncates. */
function conditionText(proposal: RuleGap["proposal"]): string {
  const field = proposal.field === "notes" ? "notes" : "imported payee";
  return proposal.shape === "one-of"
    ? `${field} ${proposal.texts.map((t) => `is "${t}"`).join(" or ")}`
    : `${field} ${proposal.candidate.op} ${proposal.candidate.value}`;
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
  // For an exact list, the first text rather than all of them run together: the
  // editor only speaks `contains` and `matches`, so joining the list produced a
  // value matching a string that appears nowhere in the budget.
  const currentValue =
    proposal.shape === "matches" ? proposal.candidate.value : (proposal.texts[0] ?? "");
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

/**
 * Undo for the bulk accept.
 *
 * Accepting every safe row is one click; clearing them was one click per row,
 * which made the bulk action a thing you had to be sure about before using.
 * Clears every accepted row, not only the safe ones - it is the visible count
 * it offers to clear.
 */
export function ClearAcceptedRulesButton({
  acceptedCount,
  onClear,
}: {
  acceptedCount: number;
  onClear: () => void;
}) {
  if (acceptedCount === 0) return null;
  return (
    <Button size="sm" variant="ghost" onClick={onClear}>
      Clear {acceptedCount} accepted
    </Button>
  );
}

/**
 * The bulk action, mirroring "Accept n safe" on the suggestions tab.
 *
 * It used to read "Create n safe rules", which named something it does not do:
 * it accepts rows, and the write happens on save like every other decision here.
 */
export function AcceptSafeRulesButton({
  safeCount,
  onAccept,
}: {
  safeCount: number;
  onAccept: () => void;
}) {
  if (safeCount === 0) return null;
  return (
    <Button size="sm" variant="outline" onClick={onAccept}>
      <Check className="size-3.5" aria-hidden="true" />
      Accept {safeCount} safe {safeCount === 1 ? "rule" : "rules"}
    </Button>
  );
}
