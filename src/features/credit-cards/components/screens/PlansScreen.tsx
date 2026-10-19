"use client";
import { useState, type ReactNode } from "react";
import { ArrowLeft, ListFilter, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ActivityRow, ActivitySnapshot } from "../../lib/activity";
import type { Card, PlanEntry, RepaymentPlan, Workspace } from "../../lib/models";
import { planLedger } from "../../lib/derive/planAccounts";
import { activityKind } from "../../lib/derive/types";
import { planEntryFor, planProgress, planProjection, planStatus, planTermsRemaining } from "../../lib/plans";
import { creditCardStore } from "../../lib/store/store";
import { daysBetween } from "@/lib/financial-models/calendar/dates";
import { planTimeline, type TimelineRow } from "./planTimeline";
import { ClearedHeader, ClearedStatus } from "@/components/ui/cleared-status";
import { activityCategoryLabel } from "../../lib/activity";
import { statementsByRow } from "../../lib/statements";
import { INSTALMENT_PLANS_DESCRIPTION } from "../../lib/vocabulary";
import { GuideLink } from "../guide/CreditCardGuide";
import { discoverPlans, type PlanCandidate } from "../../lib/derive/planDiscovery";
import { CardMenuContent } from "../CardMenuContent";
import type { CardEntry } from "../cardEntry";
import { PlanLinkDialog } from "../PlanLinkDialog";
import { AddPlanTransaction } from "../AddPlanTransaction";
import { amountClass } from "../planLink";
import { DataTable, Notes, Text, type Column } from "../primitives/DataTable";
import { StatusBadge } from "../primitives/StatusBadge";
import { MISSING, money, plural, shortDate } from "../primitives/format";

type Props = {
  budget: string;
  entry: CardEntry;
  workspace: Workspace;
  canEdit: boolean;
  /** The plan open in the plan view (URL `plan`), or null for the list. */
  planId: string | null;
  onOpenPlan: (planId: string | null) => void;
  onAdd: () => void;
  /** Opens the plan editor filled in from a plan found in a plan account. */
  onAddFound?: (candidate: PlanCandidate) => void;
  onEdit: (plan: RepaymentPlan) => void;
  onActivity: (planId: string) => void;
};

const WHERE: Record<RepaymentPlan["recordedAs"], string> = {
  "plan-account": "Plan account",
  "card-instalments": "Bank bills on card",
  "card-balance": "Balance on card",
};

const accountNameOf = (snapshot: ActivitySnapshot | undefined, id: string) =>
  snapshot?.accounts?.find((account) => account.id === id)?.name ?? "Plan account";

function usePlanActions(budget: string, workspace: Workspace, snapshot: ActivitySnapshot | undefined, today: string) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    try {
      setError("");
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save the change");
    }
  }
  const saveEntries = (plan: RepaymentPlan, entries: PlanEntry[], next: RepaymentPlan = plan) => run(async () => {
    if (!snapshot) throw new Error("Refresh Actual first");
    await creditCardStore.getState().savePlan(budget, plan.revision, snapshot, next, entries);
  });
  const entriesOf = (plan: RepaymentPlan) => workspace.planEntries.filter((item) => item.planId === plan.id);
  const finish = (plan: RepaymentPlan) => saveEntries(plan, entriesOf(plan), { ...plan, status: "completed", endedOn: today });
  const remove = (plan: RepaymentPlan, after?: () => void) => setConfirm({
    title: `Remove plan ${plan.name}?`,
    message: "Removes the plan from Bench. Actual balances and transactions stay unchanged, and its plan account stays registered. You can Undo.",
    destructiveLabel: "Remove plan",
    onConfirm: () => { void run(async () => { await creditCardStore.getState().deletePlan(budget, plan.id, plan.revision); after?.(); }); },
  });
  const dialog = <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }} state={confirm} />;
  return { error, saveEntries, entriesOf, finish, remove, dialog };
}

function summary(plan: RepaymentPlan, card: Card, workspace: Workspace, snapshot: ActivitySnapshot | undefined, today: string) {
  const status = planStatus(plan, card, workspace, snapshot, today);
  const progress = planProgress(plan, card, workspace, snapshot);
  const outside = plan.recordedAs === "plan-account" ? null : planTermsRemaining(plan, card, today);
  const ends = plan.endedOn ?? plan.expiryDate ?? planProjection(plan, card).rows.at(-1)?.date ?? null;
  return { plan, status, progress, outside, ends };
}
type Summary = ReturnType<typeof summary>;

const remainingText = ({ status, outside }: Summary) =>
  status.principalMinor !== null ? money(status.principalMinor) : outside !== null ? `≈ ${money(outside)}*` : MISSING;
const statusTone = ({ status }: Summary) => (status.check ? "attention" : status.key === "on-track" ? "success" : "neutral");

/**
 * Plans (§9.10): every plan on the card, then a full-width plan view per plan with its transactions
 * and schedule. Plan accounts are registered from the plan editor or card Settings › Instalment plans, and listed there;
 * untagged plan-account entries show here as attention items that name the tag to add.
 */
export function PlansScreen(props: Props) {
  const { workspace, entry, planId } = props;
  const plan = planId ? workspace.plans.find((item) => item.id === planId && item.cardId === entry.card.id) : undefined;
  return plan ? <PlanView {...props} plan={plan} /> : <PlanList {...props} />;
}

function PlanList({ budget, entry, workspace, canEdit, onOpenPlan, onAdd, onAddFound, onEdit, onActivity }: Props) {
  const { card, snapshot, today, name } = entry;
  const plans = workspace.plans.filter((plan) => plan.cardId === card.id);
  const actions = usePlanActions(budget, workspace, snapshot, today);
  const ledger = snapshot ? planLedger(card, workspace, snapshot) : null;
  const rows = plans.map((plan) => summary(plan, card, workspace, snapshot, today));
  const columns: Column<Summary>[] = [
    { key: "plan", header: "Plan", width: 200, cell: ({ plan }) => <Text className="font-medium">{plan.name}{plan.status === "active" ? "" : " (ended)"}</Text> },
    {
      key: "where", header: "Where the principal is", width: 210,
      cell: ({ plan }) => <Text>{plan.recordedAs === "plan-account" ? accountNameOf(snapshot, plan.planAccountId!) : WHERE[plan.recordedAs]}</Text>,
    },
    {
      key: "tag", header: "Tag", width: 120, description: "Shared plan accounts match transfers by this tag in their notes.",
      cell: ({ plan }) => plan.planAccountTag ?? (plan.recordedAs === "plan-account" ? "Own account" : MISSING),
    },
    {
      key: "original", header: "Original amount", width: 130, align: "right", description: "The amount the plan was made for.",
      cell: ({ plan }) => (plan.originalAmountMinor ? money(plan.originalAmountMinor) : MISSING),
    },
    { key: "remaining", header: "Remaining", width: 130, align: "right", cell: remainingText },
    {
      key: "billed", header: "Billed", width: 160, description: "Instalments billed, counted by statement cycle.",
      cell: ({ progress, plan }) => (plan.scheduleKind === null || !progress.tracked.length ? "Balance only" : <span className="flex items-center gap-2">
        <span className="w-14 shrink-0">{progress.billedCount} of {progress.tracked.length}</span>
        <span className="h-1.5 min-w-8 flex-1 rounded-full bg-muted" aria-hidden>
          <span className="block h-1.5 rounded-full bg-foreground/70" style={{ width: `${progress.billedCount / progress.tracked.length * 100}%` }} />
        </span>
      </span>),
    },
    {
      key: "next", header: "Next", width: 110, align: "right",
      cell: ({ progress, plan }) => (progress.next && plan.status === "active" ? money(progress.next.amountMinor) : MISSING),
    },
    {
      key: "nextDate", header: "Next due", width: 96,
      cell: ({ progress, plan }) => (progress.next && plan.status === "active" ? shortDate(progress.next.date, today) : MISSING),
    },
    { key: "ends", header: "Ends", width: 100, cell: ({ ends }) => (ends ? shortDate(ends, today) : MISSING) },
    {
      key: "status", header: "Status", width: 280,
      cell: (row) => <span className="flex items-center gap-2">
        <StatusBadge label={row.status.label} tone={statusTone(row)} line={row.status.detail} />
        {row.plan.status === "active" && row.status.principalMinor === 0 && row.status.detail
          && <Button tabIndex={-1} size="xs" variant="outline" disabled={!canEdit} onClick={() => actions.finish(row.plan)}>Mark finished</Button>}
      </span>,
    },
    {
      key: "actions", header: "Actions", hiddenHeader: true, width: 36, align: "center", sticky: "end",
      cell: ({ plan }) => <DropdownMenu>
        <DropdownMenuTrigger render={<Button data-row-menu tabIndex={-1} size="icon-xs" variant="ghost" aria-label={`Actions for plan ${plan.name}`} />}>
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <CardMenuContent>
          <DropdownMenuItem onClick={() => onOpenPlan(plan.id)}>Open plan</DropdownMenuItem>
          <DropdownMenuItem disabled={!canEdit} onClick={() => onEdit(plan)}>Edit plan</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onActivity(plan.id)}>View in Activity</DropdownMenuItem>
          {plan.status === "active" && <DropdownMenuItem disabled={!canEdit} onClick={() => actions.finish(plan)}>Mark finished</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => actions.remove(plan)}>Remove plan</DropdownMenuItem>
        </CardMenuContent>
      </DropdownMenu>,
    },
  ];
  const found = snapshot ? discoverPlans(card, workspace, snapshot) : null;
  const covered = new Set([...(found?.candidates.flatMap((candidate) => candidate.rowIds) ?? []), ...(found?.ambiguous.map((row) => row.id) ?? [])]);
  // Entries a found plan or an ambiguity already explains are not repeated as "no plan".
  const untagged = (ledger?.unassigned ?? []).filter((row) => !covered.has(row.id));

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
      <div className="min-w-0">
        <p className="text-sm">{plural(plans.filter((plan) => plan.status === "active").length, "active instalment plan")}</p>
        <p className="text-xs text-muted-foreground">{INSTALMENT_PLANS_DESCRIPTION} <GuideLink section="plans" className="ml-1 align-baseline">How instalment plans work</GuideLink></p>
      </div>
      <Button size="sm" disabled={!canEdit} onClick={onAdd}><Plus className="size-3.5" aria-hidden />Add instalment plan</Button>
    </div>
    {found && found.candidates.length > 0 && <section aria-label="Found in your plan accounts" className="shrink-0 border-b bg-blue-50/60 px-4 py-2 text-sm dark:bg-blue-950/20">
      <h2 className="text-xs font-semibold">
        {plural(found.candidates.length, "instalment plan")} found in your plan accounts
      </h2>
      <p className="text-xs text-muted-foreground">Transfers with this card under a #tag no plan uses yet. Add each one to track it; nothing changes in Actual.</p>
      <ul className="mt-1.5 divide-y divide-border/60">{found.candidates.map((candidate) => <li key={candidate.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5 text-xs">
        <span className="w-56 truncate font-medium" title={candidate.name}>{candidate.name}</span>
        <span className="w-40 truncate text-muted-foreground">{candidate.tag ?? "Whole account"} · {candidate.accountName}</span>
        <span className="w-44 tabular-nums">{money(candidate.originalMinor)} from {candidate.startDate ? shortDate(candidate.startDate, today) : MISSING}</span>
        <span className="w-44 tabular-nums">{candidate.finished ? `Finished ${shortDate(candidate.lastDate, today)}` : `${money(candidate.remainingMinor)} remaining`}</span>
        <span className="text-muted-foreground">{plural(candidate.transfers, "transfer")}{candidate.bookings > 1 ? ` · ${candidate.bookings} bookings` : ""}</span>
        <Button size="xs" variant="outline" className="ml-auto" disabled={!canEdit || !onAddFound}
          onClick={() => onAddFound?.(candidate)}><Plus className="size-3" aria-hidden />Add plan</Button>
      </li>)}</ul>
    </section>}
    {found && found.ambiguous.length > 0 && <p role="status" className="shrink-0 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      {plural(found.ambiguous.length, "transfer")} {found.ambiguous.length === 1 ? "carries" : "carry"} two plan tags ({found.ambiguous.slice(0, 3).map((row) => `${shortDate(row.date, today)} ${money(row.amountMinor)}`).join(", ")}
      {found.ambiguous.length > 3 ? ", …" : ""}). Keep one plan tag per transfer in Actual, then Refresh.
    </p>}
    {untagged.length > 0 && <section aria-label="Plan account entries without a plan" className="shrink-0 border-b bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/30">
      <h2 className="text-xs font-semibold text-amber-900 dark:text-amber-200">
        {plural(untagged.length, "plan-account entry", "plan-account entries")} with no plan
      </h2>
      <ul className="mt-1 space-y-0.5">{untagged.map((row) => <li key={row.id} className="flex flex-wrap gap-x-3 text-xs">
        <span className="w-20 shrink-0">{shortDate(row.date, today)}</span>
        <span className="w-56 truncate">{row.label}</span>
        <span className="w-24 shrink-0 text-right tabular-nums">{money(row.amountMinor)}</span>
        <span className="text-muted-foreground">{untaggedFix(row, workspace, snapshot)}</span>
      </li>)}</ul>
    </section>}
    {actions.error && <p role="alert" className="shrink-0 px-4 py-2 text-sm text-destructive">{actions.error}</p>}
    {plans.length > 0
      ? <DataTable<Summary>
        label={`Instalment plans for ${name}`}
        columns={columns}
        rows={rows}
        rowKey={({ plan }) => plan.id}
        rowLabel={({ plan, status }) => `${plan.name} · ${status.label}`}
        onOpen={({ plan }) => onOpenPlan(plan.id)}
      />
      : <p className="px-4 py-6 text-sm text-muted-foreground">No instalment plans yet. Add one here, or choose Make this a plan on a purchase.</p>}
    {rows.some((row) => row.outside !== null) && <p className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
      * Not recorded in Actual: estimated from the plan terms. Billed counts statement cycles, not calendar months.
    </p>}
    {actions.dialog}
  </div>;
}

/** What to do about a plan-account entry no plan owns: name the tag to add in Actual. */
function untaggedFix(row: ActivityRow, workspace: Workspace, snapshot: ActivitySnapshot | undefined) {
  const tags = workspace.plans.filter((plan) => plan.planAccountId === row.accountId && plan.planAccountTag).map((plan) => plan.planAccountTag);
  const account = accountNameOf(snapshot, row.accountId);
  return tags.length
    ? `In ${account}: add ${tags.join(" or ")} to its notes in Actual, then Refresh.`
    : `In ${account}: add a plan that uses this account.`;
}

function PlanView({ budget, entry, workspace, canEdit, plan, onOpenPlan, onEdit, onActivity }: Props & { plan: RepaymentPlan }) {
  const { card, snapshot, today } = entry;
  const actions = usePlanActions(budget, workspace, snapshot, today);
  const [linking, setLinking] = useState<ActivityRow | null>(null);
  const [adding, setAdding] = useState(false);
  const info = summary(plan, card, workspace, snapshot, today);
  const left = info.status.principalMinor ?? info.outside;
  const timeline = planTimeline(plan, card, workspace, snapshot, today, left);
  const entries = actions.entriesOf(plan);
  const link = ({ row, suggestion }: NonNullable<TimelineRow["suggestion"]>) => actions.saveEntries(plan,
    [...entries, planEntryFor(plan.id, row, suggestion.role, suggestion.instalmentNumber)]);
  const unlink = (row: ActivityRow) => actions.saveEntries(plan, entries.filter((item) => item.transactionId !== row.id));
  const where = plan.recordedAs === "plan-account"
    ? `${accountNameOf(snapshot, plan.planAccountId!)}${plan.planAccountTag ? ` · ${plan.planAccountTag}` : ""}`
    : WHERE[plan.recordedAs];
  // A plan has one original purchase; one made before the card's tracked window is never loaded.
  const hasOriginal = entries.some((item) => item.role === "original");
  const beforeTracking = Boolean(snapshot && plan.startDate && plan.startDate < snapshot.from);
  const canAdd = plan.recordedAs !== "plan-account" || (!hasOriginal && !beforeTracking);
  const kindOf = (row: ActivityRow) => (snapshot && row.accountId === card.accountId ? activityKind(row, card, workspace, snapshot) : null);

  // Progress: instalments billed against the schedule, or principal back on the card without one.
  const scheduled = plan.scheduleKind !== null && info.progress.tracked.length > 0;
  const original = plan.originalAmountMinor;
  const back = original && left !== null ? Math.max(0, original - left) : null;
  const fraction = scheduled ? info.progress.billedCount / info.progress.tracked.length : back !== null && original ? back / original : null;
  const finished = plan.status !== "active" || left === 0;
  const endsLine = timeline.closedEarly && timeline.lastPostedDate ? `closed early on ${shortDate(timeline.lastPostedDate, today)}`
    : finished ? "finished"
      : info.ends && info.ends > today ? `${plural(Math.max(1, Math.round(daysBetween(today, info.ends) / 30.4)), "month")} left` : undefined;

  const onStatement = snapshot ? statementsByRow(card.id, workspace, snapshot) : null;
  const columns: Column<TimelineRow>[] = [
    {
      key: "due", header: "Due", group: "Dates", width: 96, description: "When the instalment was expected.",
      cell: (row) => (row.dueDate ? shortDate(row.dueDate, today) : MISSING),
    },
    {
      key: "posted", header: "Date", group: "Dates", width: 96, description: "The transaction's date in Actual.",
      cell: (row) => (row.postedDate ? shortDate(row.postedDate, today) : MISSING),
    },
    {
      key: "event", header: "Event", width: 170,
      cell: (row) => <Text title={row.via} className={row.source === "suggested" ? "text-muted-foreground italic" : undefined}>{row.event}</Text>,
    },
    { key: "expected", header: "Expected", group: "Amount", width: 110, align: "right", cell: (row) => (row.expectedMinor === null ? MISSING : money(row.expectedMinor)) },
    {
      key: "actual", header: "Actual", group: "Amount", width: 110, align: "right",
      cell: (row) => {
        if (!row.actual) return row.suggestion ? <span className="text-muted-foreground italic">{money(row.suggestion.row.amountMinor)}?</span> : MISSING;
        const kind = kindOf(row.actual);
        return <span className={kind ? amountClass(kind, row.actual.amountMinor) : undefined}>{money(row.actual.amountMinor)}</span>;
      },
    },
    {
      key: "difference", header: "Difference", group: "Amount", width: 100, align: "right",
      description: "Actual minus expected, when they differ.",
      cell: (row) => (row.differenceMinor === null ? "" : <span className="text-amber-700 dark:text-amber-400">{row.differenceMinor > 0 ? "+" : ""}{money(row.differenceMinor)}</span>),
    },
    {
      key: "remaining", header: "Remaining", group: "Amount", width: 120, align: "right",
      description: "Principal still owed after this row; projected for instalments still to come.",
      cell: (row) => (row.remainingMinor === null ? MISSING : <span className={row.actual ? undefined : "text-muted-foreground"}>{money(row.remainingMinor)}</span>),
    },
    {
      key: "category", header: "Category", group: "Transaction", width: 200,
      cell: (row) => (row.actual && snapshot ? <Text>{activityCategoryLabel(row.actual, snapshot)}</Text> : MISSING),
    },
    { key: "notes", header: "Notes", group: "Transaction", width: 240, grow: true, cell: (row) => <Notes notes={row.notes} /> },
    {
      key: "cleared", header: "Cleared", group: "Transaction", headerIcon: <ClearedHeader />, width: 44, align: "center",
      cell: (row) => (row.actual ? <ClearedStatus cleared={row.actual.cleared} /> : null),
    },
    {
      key: "statement", header: "Statement", group: "Transaction", width: 90, description: "The bill the transaction is on.",
      cell: (row) => {
        const statement = row.actual ? onStatement?.get(row.actual.id) : undefined;
        return statement ? shortDate(statement.closingDate, today) : MISSING;
      },
    },
    {
      key: "status", header: "Status", width: 200,
      cell: (row) => <span className="flex items-center gap-2">
        <StatusBadge label={row.status.label} tone={row.status.tone} line={row.status.line} />
        {row.suggestion && <span className="truncate text-xs text-muted-foreground" title={row.suggestion.suggestion.reason}>
          Suggested · {shortDate(row.suggestion.row.date, today)}
        </span>}
      </span>,
    },
    {
      key: "actions", header: "Actions", hiddenHeader: true, width: 64, sticky: "end",
      cell: (row) => row.suggestion
        ? <Button tabIndex={-1} size="xs" variant="outline" disabled={!canEdit} onClick={() => link(row.suggestion!)}>Link</Button>
        : row.source === "linked" && row.actual ? <DropdownMenu>
          <DropdownMenuTrigger render={<Button data-row-menu tabIndex={-1} size="icon-xs" variant="ghost" aria-label={`Actions for ${row.event}`} />}>
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <CardMenuContent>
            <DropdownMenuItem disabled={!canEdit} onClick={() => setLinking(row.actual)}>Change role</DropdownMenuItem>
            <DropdownMenuItem disabled={!canEdit} onClick={() => unlink(row.actual!)}>Unlink</DropdownMenuItem>
          </CardMenuContent>
        </DropdownMenu> : null,
    },
  ];
  const figure = (label: string, value: ReactNode, detail?: ReactNode) => <div className="min-w-0 px-4 py-3">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 truncate text-lg font-semibold tabular-nums">{value}</dd>
    {detail && <dd className="truncate text-xs text-muted-foreground">{detail}</dd>}
  </div>;

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2">
      <Button size="xs" variant="outline" onClick={() => onOpenPlan(null)}><ArrowLeft className="size-3.5" aria-hidden />All plans</Button>
      <h2 className="truncate text-sm font-semibold">{plan.name}</h2>
      <StatusBadge label={info.status.label} tone={statusTone(info)} line={info.status.detail} />
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onActivity(plan.id)}><ListFilter className="size-3.5" aria-hidden />View in Activity</Button>
        <Button size="sm" disabled={!canEdit} onClick={() => onEdit(plan)}><Pencil className="size-3.5" aria-hidden />Edit plan</Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-sm" variant="outline" aria-label={`More actions for plan ${plan.name}`} />}>
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <CardMenuContent>
            {plan.status === "active" && <DropdownMenuItem disabled={!canEdit} onClick={() => actions.finish(plan)}>Mark finished</DropdownMenuItem>}
            <DropdownMenuItem variant="destructive" onClick={() => actions.remove(plan, () => onOpenPlan(null))}>Remove plan</DropdownMenuItem>
          </CardMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <dl aria-label={`Plan ${plan.name}`} className="grid shrink-0 grid-cols-2 divide-x border-b md:grid-cols-3 xl:grid-cols-5">
      {figure("Remaining", remainingText(info), original ? `of ${money(original)}` : undefined)}
      {figure("Progress", fraction === null ? MISSING : <span className="flex items-center gap-2">
        <span className="h-2 w-28 rounded-full bg-muted" aria-hidden>
          <span className="block h-2 rounded-full bg-foreground/70" style={{ width: `${Math.min(100, fraction * 100)}%` }} />
        </span>
        <span className="text-sm">{scheduled ? `${info.progress.billedCount} of ${info.progress.tracked.length}` : `${Math.round(fraction * 100)}%`}</span>
      </span>, scheduled ? `billed${back !== null ? ` · ${money(back)} back on the card` : ""}` : back !== null ? `${money(back)} back on the card` : "balance only")}
      {figure("Next instalment", info.progress.next && !finished ? money(info.progress.next.amountMinor) : MISSING,
        info.progress.next && !finished ? `due ${shortDate(info.progress.next.date, today)}` : undefined)}
      {figure("Ends", info.ends ? shortDate(info.ends, today) : MISSING, endsLine)}
      {figure("Principal held in", where)}
    </dl>
    {info.status.check && info.status.detail && <p role="status" className="shrink-0 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      {info.status.label}: {info.status.detail}
    </p>}
    {actions.error && <p role="alert" className="shrink-0 px-4 py-2 text-sm text-destructive">{actions.error}</p>}
    <section aria-label="Timeline" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2">
        <h3 className="text-sm font-semibold">Timeline</h3>
        {timeline.suggestedCount > 0 && <span className="text-xs text-blue-700 dark:text-blue-300">{plural(timeline.suggestedCount, "suggested match", "suggested matches")} to check</span>}
        {!snapshot && <span className="text-xs text-muted-foreground">Refresh Actual to see transactions.</span>}
        {plan.recordedAs === "plan-account" && snapshot && <span className="text-xs text-muted-foreground">
          Transfers with {accountNameOf(snapshot, plan.planAccountId!)} belong here {plan.planAccountTag ? `by the tag ${plan.planAccountTag}` : "automatically"}.
        </span>}
        {snapshot && beforeTracking && !hasOriginal && <span className="text-xs text-muted-foreground">
          This plan started before tracking ({shortDate(plan.startDate!, today)}), so its purchase isn&apos;t loaded. Its original amount and start date already cover it.
        </span>}
        {snapshot && canAdd && <Button size="sm" variant="outline" className="ml-auto" disabled={!canEdit} onClick={() => setAdding(true)}>
          <Plus className="size-3.5" aria-hidden />{plan.recordedAs === "plan-account" ? "Add original purchase" : "Add transaction"}
        </Button>}
      </div>
      <DataTable<TimelineRow>
        label={`Timeline for plan ${plan.name}`}
        compact
        columns={columns}
        rows={timeline.rows}
        rowKey={(row) => row.key}
        rowLabel={(row) => `${shortDate(row.date)} · ${row.event} · ${row.status.label}`}
        onOpen={(row) => {
          if (!canEdit) return;
          if (row.suggestion) void link(row.suggestion);
          else if (row.source === "linked" && row.actual) setLinking(row.actual);
        }}
        empty={plan.scheduleKind === null ? "No plan transactions yet." : "No schedule or transactions yet."}
      />
      {plan.scheduleKind !== null && !info.progress.rows.length && <p className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
        {planProjection(plan, card).reason}
      </p>}
    </section>
    {adding && snapshot && <AddPlanTransaction budget={budget} card={card} plan={plan} workspace={workspace} snapshot={snapshot}
      available={canEdit} onlyOriginal={plan.recordedAs === "plan-account"} onClose={() => setAdding(false)} />}
    {linking && snapshot && <PlanLinkDialog budget={budget} card={card} rows={[linking]} workspace={workspace} snapshot={snapshot}
      available={canEdit} onClose={() => setLinking(null)} />}
    {actions.dialog}
  </div>;
}
