"use client";
import { useEffect } from "react";
import { useStore } from "zustand";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import Link from "next/link";
import { daysBetween } from "@/lib/financial-models/calendar/dates";
import { selectActiveInstance, useConnectionStore, type ConnectionInstance } from "@/store/connection";
import { useCreditCardActivities, useCreditCardPlanAccounts } from "../hooks/useCreditCardActivity";
import { useCreditCardDirectory } from "../hooks/useCreditCardDirectory";
import { workspaceQuery } from "../hooks/useWorkspaceUrl";
import { bankToday, type StatementDraft } from "../lib/cycles";
import { deriveCardView } from "../lib/derive/cardView";
import { currentCardBalance } from "../lib/derive/currentBalance";
import { formatCardDate } from "../lib/displayDates";
import type { Card, Statement, Workspace } from "../lib/models";
import { cardReadSnapshot } from "../lib/readModel";
import { creditCardStore, EMPTY_WORKSPACE } from "../lib/store/store";
import { StatementEditor } from "./CardEditors";
import { money } from "./primitives/format";

/**
 * The bridge other tools use to enter a card's bank statement figures (PR-128): a statement picker, then the
 * Credit Cards statement editor. It saves through the credit-card store exactly as Credit Cards does and never
 * opens a review.
 */

/** This budget's registered cards, loading Bench's credit-card records if needed. */
export function useRegisteredCards(connection: ConnectionInstance | null) {
  const budget = connection?.budgetSyncId ?? "";
  const status = useStore(creditCardStore, (state) => state.status[budget]);
  const cards = useStore(creditCardStore, (state) => state.workspaces[budget]?.cards);
  useEffect(() => { if (budget) void creditCardStore.getState().load(budget); }, [budget]);
  return { ready: status?.state === "ready", cards: cards ?? [] };
}

export type StatementChoice = {
  closingDate: string;
  dueDate: string;
  /** A saved statement; absent for one not entered yet. */
  statement?: Statement;
  /** Bench's estimate, used to pre-fill one not entered yet. */
  draft?: StatementDraft;
  state: "not-entered" | "entered" | "verified";
};

/** The card's statements to pick from, newest first: saved ones and the estimates not entered yet. */
export function statementChoices(card: Card, workspace: Workspace, drafts: readonly StatementDraft[]): StatementChoice[] {
  const saved = workspace.statements.filter((entry) => entry.cardId === card.id && !entry.estimate);
  const choices: StatementChoice[] = saved.map((statement) => ({
    closingDate: statement.closingDate,
    dueDate: statement.dueDate,
    statement,
    draft: drafts.find((entry) => entry.closingDate === statement.closingDate),
    state: statement.reviewState === "verified" ? "verified" : "entered",
  }));
  for (const draft of drafts) {
    if (saved.some((entry) => entry.closingDate === draft.closingDate)) continue;
    choices.push({ closingDate: draft.closingDate, dueDate: draft.dueDate, draft, state: "not-entered" });
  }
  return choices.sort((a, b) => b.closingDate.localeCompare(a.closingDate));
}

/** The one to suggest: the earliest statement not entered yet, else the newest. */
export function suggestedChoice(choices: readonly StatementChoice[]) {
  return [...choices].reverse().find((entry) => entry.state === "not-entered") ?? choices[0];
}

const STATE_LABEL = { "not-entered": "Not entered", entered: "Entered", verified: "Verified" } as const;

/** One line per statement: closing date, period, balance (≈ for an estimate) and whether its figures are in. */
export function choiceLabel(choice: StatementChoice) {
  const source = choice.statement ?? choice.draft;
  const period = source ? `${formatCardDate(source.periodStart)} – ${formatCardDate(choice.closingDate)}` : "";
  const balance = choice.statement ? money(choice.statement.balanceMinor) : choice.draft ? `≈ ${money(choice.draft.balanceMinor)}` : "";
  return [formatCardDate(choice.closingDate), period, balance, STATE_LABEL[choice.state]].filter(Boolean).join(" · ");
}

type Props = {
  connection: ConnectionInstance;
  card: Card;
  cardName: string;
  /** Opens on this saved statement (re-editing a linked one); otherwise on the suggested statement. */
  statementId?: string | null;
  /** The statement whose figures were saved. */
  onLinked: (statementId: string) => void;
  /** Skipped or cancelled; nothing is saved. */
  onClose: () => void;
};

/**
 * One dialog: choose the statement at the top, then enter or check its figures (the Credit Cards editor with a
 * statement selector). Waits for the card's activity first, so new statements open pre-filled.
 */
export function CardStatementFigures({ connection, card, cardName, statementId, onLinked, onClose }: Props) {
  const budget = connection.budgetSyncId;
  const workspace = useStore(creditCardStore, (state) => state.workspaces[budget] ?? EMPTY_WORKSPACE);
  const directory = useCreditCardDirectory(connection);
  const [activity] = useCreditCardActivities(connection, [card], workspace.statements);
  const today = bankToday(card.bankTimeZone);
  // Plan accounts too, so a card whose statements include plan balances pre-fills exactly as in Credit Cards.
  const tracking = useCreditCardPlanAccounts(connection, workspace, today).map((query) => (query.isError ? undefined : query.data));
  const direct = connection.mode === "browser-api";
  const live = directory.data?.balances.get(card.accountId);
  const balance = currentCardBalance(card, live, activity?.data, Boolean(activity?.isError), direct);
  const balances = live && balance ? new Map([[card.accountId, live]]) : undefined;
  const snapshot = activity?.data ? cardReadSnapshot(activity.data, directory.data?.accounts, tracking, balances, direct) : undefined;
  const view = deriveCardView({ card, workspace, snapshot, rawSignedBalanceMinor: balance?.rawSignedBalanceMinor, today });
  const choices = statementChoices(card, workspace, view.drafts);
  const reading = !activity || activity.isPending;

  if (reading || !choices.length) {
    return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex flex-col gap-3 sm:max-w-md">
        <div>
          <DialogTitle>Card statement figures</DialogTitle>
          <DialogDescription>{cardName}</DialogDescription>
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {reading ? "Reading the card's activity…" : "No statements to enter yet. Check the card's billing days in Credit Cards."}
        </p>
        <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Skip</Button></div>
      </DialogContent>
    </Dialog>;
  }

  const options = choices.map((choice) => ({
    key: choice.closingDate,
    label: choiceLabel(choice),
    statement: choice.statement,
    draft: choice.statement ? undefined : choice.draft,
    previousMissing: !workspace.statements.some((entry) => entry.cardId === card.id && !entry.estimate && entry.closingDate < choice.closingDate),
    note: choice.state === "verified" ? "Changing its figures reopens its review in Credit Cards." : undefined,
  }));
  const linked = statementId ? choices.find((entry) => entry.statement?.id === statementId) : undefined;
  const initial = (linked ?? suggestedChoice(choices))!.closingDate;
  return <StatementEditor
    budgetSyncId={budget}
    card={card}
    cardName={`${cardName} · You review its transactions in Credit Cards after the reconciliation.`}
    previousMissing={false}
    canRecord
    choices={{ options, initial }}
    title="Card statement figures"
    saveLabel="Save figures"
    cancelLabel={statementId ? "Cancel" : "Skip"}
    onClose={onClose}
    onSaved={onLinked}
  />;
}

/** The saved statement a reconciliation is linked to, or null once it no longer exists. */
export function useLinkedCardStatement(statementId: string | null | undefined) {
  const connection = useConnectionStore(selectActiveInstance);
  const budget = connection?.budgetSyncId ?? "";
  const workspace = useStore(creditCardStore, (state) => state.workspaces[budget]);
  useEffect(() => { if (budget && statementId) void creditCardStore.getState().load(budget); }, [budget, statementId]);
  const statement = statementId ? workspace?.statements.find((entry) => entry.id === statementId && !entry.estimate) : undefined;
  return statement ? { statement, card: workspace?.cards.find((entry) => entry.id === statement.cardId) } : null;
}

/** An imported period clearly belongs to another statement: no overlap, or the ends more than 5 days apart. */
export function periodMismatch(statement: Pick<Statement, "periodStart" | "closingDate">, period: { start: string; end: string }) {
  if (period.end < statement.periodStart || period.start > statement.closingDate) return true;
  return Math.abs(daysBetween(period.end, statement.closingDate)) > 5;
}

/** Credit Cards, on the card's Statements tab with this statement's review open. */
export const cardStatementReviewHref = (cardId: string, statementId: string) =>
  `/credit-cards${workspaceQuery({ card: cardId, tab: "statements", review: statementId })}`;

/**
 * The reconciliation header's card-statement action: "Card statement 01 Oct" (amber with a reason when the
 * imported period differs) opens its figures again; for a registered card with nothing linked, "Enter card
 * statement figures". Nothing for other accounts.
 */
export function CardStatementHeaderAction({ statementId, accountId, period, onOpen }: {
  statementId: string | null | undefined;
  accountId: string | undefined;
  period?: { start: string; end: string } | null;
  onOpen?: () => void;
}) {
  const connection = useConnectionStore(selectActiveInstance);
  const linked = useLinkedCardStatement(statementId);
  const { cards } = useRegisteredCards(connection);
  const registered = Boolean(accountId && cards.some((entry) => entry.accountId === accountId));
  if (!linked) {
    return registered && onOpen
      ? <button type="button" onClick={onOpen} className="whitespace-nowrap text-xs text-primary hover:underline">· Enter card statement figures</button>
      : null;
  }
  const { statement } = linked;
  const label = `Card statement ${formatCardDate(statement.closingDate)}`;
  const differs = period ? periodMismatch(statement, period) : false;
  const reason = differs
    ? `The imported statement (${formatCardDate(period!.start)} – ${formatCardDate(period!.end)}) looks like a different statement than ${label} (${formatCardDate(statement.periodStart)} – ${formatCardDate(statement.closingDate)}).`
    : undefined;
  const text = <>· {label}{differs ? " · different period?" : ""}</>;
  const tone = differs ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground";
  return registered && onOpen
    ? <button type="button" onClick={onOpen} title={reason ?? "Check or edit its bank figures"} aria-label={`${label}: edit its figures`}
      className={`whitespace-nowrap text-xs underline-offset-2 hover:underline ${tone}`}>{text}</button>
    : <span title={reason} className={`whitespace-nowrap text-xs ${tone}`}>{text}</span>;
}

/** After Apply: an offer to open the linked statement's review in Credit Cards (never an automatic jump). */
export function ReviewCardStatementLink({ statementId }: { statementId: string | null | undefined }) {
  const linked = useLinkedCardStatement(statementId);
  if (!linked?.card) return null;
  const date = formatCardDate(linked.statement.closingDate);
  return <div role="region" aria-label="Credit card statement" className="flex flex-wrap items-center gap-3 border-b bg-blue-50/60 px-4 py-2 text-sm dark:bg-blue-950/20">
    <span className="min-w-0 flex-1 text-xs text-muted-foreground">
      This reconciliation entered the bank figures for the {date} statement. Review it in Credit Cards to match its transactions.
    </span>
    <Link href={cardStatementReviewHref(linked.card.id, linked.statement.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
      Review statement {date}
    </Link>
  </div>;
}
