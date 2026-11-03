"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import { DEBT_GROUPS, cardCosts, cardMonthly, debtAccounts, debtMonthly, debtTotals, type DebtAccountRow, type DebtGroup } from "@/lib/financial-insights/debt";
import { monthLabel } from "@/lib/financial-insights/period";
import { GRANULARITY_NAME, balanceBuckets, bucketMonths, endsEarly, lastIndex, type Granularity } from "@/lib/financial-insights/buckets";
import type { FinancialInsightsView } from "../hooks/useFinancialInsights";
import { useCardCosts } from "../hooks/useCardCosts";
import { useGranularity } from "../hooks/useGranularity";
import { MISSING, money, signedMoney, formatDay } from "../format";
import { ChartFrame } from "./ChartFrame";
import { DebtRepaymentsCard, type UpcomingLoans } from "./DebtRepaymentsCard";
import { DrillLink } from "./DrillLink";
import { TableCard, TD, TH } from "./TableCard";
import { Tile } from "./Tile";
import { UnitPills } from "./UnitPills";
import { BarChart } from "./charts/BarChart";
import { CLASS_COLOUR } from "./charts/CompositionChart";
import { monthTip } from "./charts/monthTip";

type Ready = Extract<FinancialInsightsView["data"], { state: "ready" }>;
const WARNING = "text-amber-700 dark:text-amber-400";
/** The colours of the Loan repayments card, so principal, interest and fees read the same in both. */
const PARTS = { principal: "var(--fi-invest)", interest: "var(--fi-gap)", fees: "var(--fi-g2)" } as const;
const GROUP_COLOUR: Record<DebtGroup, string> = { loans: CLASS_COLOUR.loans, cards: CLASS_COLOUR.cards, otherLiability: CLASS_COLOUR.otherLiability };

/** One colour per card, in the page's group palette; every card after the fifth is "Other cards". */
const CARD_COLOURS = ["var(--fi-g1)", "var(--fi-g2)", "var(--fi-g0)", "var(--fi-g4)", "var(--fi-g6)"];
const OTHER_CARDS = "var(--fi-g10)";

const HEAD = ["Account", "Start", "End", "Change", "Principal repaid", "Next 12 months", "Later"];

/** Loans & cards: what you still owe, and what your payments are doing to it. Display only. */
export function LoansTab({ data, today, onDrill, onOpenAssets }: { data: Ready; today: string; onDrill: (target: DrillTarget) => void; onOpenAssets?: () => void }) {
  const { ledger, period, summary, debt, schedules } = data;
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["As of", formatDay(period.endDate)]];
  const [closed, setClosed] = useState<ReadonlySet<DebtGroup>>(new Set());
  const toggle = (key: DebtGroup) => setClosed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const rows = useMemo(() => debtAccounts(ledger, period, today, debt, schedules), [ledger, period, today, debt, schedules]);
  const months = useMemo(() => debtMonthly(ledger, period), [ledger, period]);
  const cardMonths = useMemo(() => cardMonthly(ledger, period), [ledger, period]);
  const costSettings = useCardCosts(true);
  const costs = useMemo(() => (costSettings.state === "ready" ? cardCosts(ledger, period, costSettings.cards) : null), [ledger, period, costSettings]);
  const totals = useMemo(() => debtTotals(rows), [rows]);
  // What debt cost in the period: the interest and fees of the tracked loans, and what the cards were charged where their categories are set.
  const loanCost = debt.interestMinor + debt.feesMinor;
  const cardCost = costs && costs.identified.length > 0 ? costs.interest.reduce((a, v, i) => a + (costs.hasData[i] ? v : 0), 0) + costs.fees.reduce((a, v, i) => a + (costs.hasData[i] ? v : 0), 0) : null;
  const loans = rows.filter((r) => r.group === "loans");
  const hasLoans = loans.length > 0;
  const hasCards = rows.some((r) => r.group === "cards");
  const owedAtStart = 0 - (summary.opening.loans + summary.opening.cards + summary.opening.otherLiabilities);
  const untracked = debt.rows.filter((r) => !r.tracked);
  const upcoming: UpcomingLoans = { loans: totals.loans, scheduled: totals.scheduledLoans, toReview: loans.filter((r) => r.next12?.state === "review").length, principalMinor: totals.principalNext12Minor, costMinor: totals.costNext12Minor };
  const link = (amount: number, target: DrillTarget, label: string, signed = false) => (amount === 0 ? <>{money(0)}</> : <DrillLink label={`${label} ${signed ? signedMoney(amount) : money(amount)}`} onClick={() => onDrill(target)}>{signed ? signedMoney(amount) : money(amount)}</DrillLink>);

  // ── The months: principal, interest and fees (a quarter or year adds up its months) ──
  const [payUnit, setPayUnit] = useGranularity(months.length);
  const payNames = GRANULARITY_NAME[payUnit];
  const payBuckets = useMemo(() => bucketMonths(months.map((m) => m.month), months.map((m) => m.hasData), months.map((m) => m.partial), payUnit), [months, payUnit]);
  const labels = payBuckets.map((b) => b.label);
  const payPartials = payBuckets.flatMap((b, i) => (b.partial ? [i] : []));
  const paySum = (pick: (m: (typeof months)[number]) => number) => payBuckets.map((b) => (b.hasData ? b.indexes.reduce((total, i) => total + (months[i].hasData ? pick(months[i]) : 0), 0) : null));
  const drawn = hasLoans && months.some((m) => m.principalMinor !== 0 || m.interestMinor !== 0 || m.feesMinor !== 0);
  const series = [
    { key: "principal", label: "Principal", colour: PARTS.principal, values: paySum((m) => m.principalMinor), drill: "loanPrincipal" as const },
    { key: "interest", label: "Interest", colour: PARTS.interest, values: paySum((m) => m.interestMinor), drill: "loanInterest" as const },
    { key: "fees", label: "Fees", colour: PARTS.fees, values: paySum((m) => m.feesMinor), drill: "loanFees" as const },
  ];

  // ── Credit cards: balances by month, and the interest and fees charged ──
  // Balances: a quarter or year is stood for by its last month's balance. Interest and fees add up their months.
  const [balUnit, setBalUnit] = useGranularity(cardMonths.months.length);
  const balNames = GRANULARITY_NAME[balUnit];
  const balBuckets = useMemo(() => balanceBuckets(cardMonths.months, balUnit), [cardMonths.months, balUnit]);
  const cardLabels = balBuckets.map((b) => b.label);
  const balStopsEarly = balBuckets.length > 0 && endsEarly(balBuckets[balBuckets.length - 1], balUnit);
  const cardPartial = cardMonths.partial !== null || balStopsEarly ? balBuckets.length - 1 : null;
  const atBucketEnd = <T,>(values: readonly T[]) => balBuckets.map((b) => values[lastIndex(b)]);
  const shownCards = cardMonths.cards.slice(0, CARD_COLOURS.length);
  const otherCards = cardMonths.cards.slice(CARD_COLOURS.length);
  const cardSeries = [
    ...shownCards.map((c, i) => ({ key: c.accountId, label: c.name, colour: CARD_COLOURS[i], values: atBucketEnd(c.values) })),
    ...(otherCards.length > 0 ? [{ key: "other", label: "Other cards", colour: OTHER_CARDS, values: atBucketEnd(cardMonths.months.map((_, i) => (cardMonths.hasData[i] ? otherCards.reduce((a, c) => a + (c.values[i] ?? 0), 0) : null))) }] : []),
  ];
  const cardTotals = atBucketEnd(cardMonths.totals);
  const cardTable = cardMonths.cards.map((c) => atBucketEnd(c.values));
  const [costUnit, setCostUnit] = useGranularity(cardMonths.months.length);
  const costNames = GRANULARITY_NAME[costUnit];
  const costBuckets = useMemo(() => bucketMonths(cardMonths.months, cardMonths.hasData, cardMonths.months.map((_, i) => cardMonths.partial === i), costUnit), [cardMonths, costUnit]);
  const costLabels = costBuckets.map((b) => b.label);
  const costPartials = costBuckets.flatMap((b, i) => (b.partial ? [i] : []));
  const costSum = (values: readonly number[] | undefined) => costBuckets.map((b) => (b.hasData && values ? b.indexes.reduce((total, i) => total + (cardMonths.hasData[i] ? values[i] : 0), 0) : null));
  // Interest and fees: the entries in each card's account with the category the Credit Cards module maps to that card.
  const costParts = [
    { key: "interest", label: "Interest", colour: PARTS.interest, values: costs ? costSum(costs.interest) : [], categoryIds: [...new Set((costs?.identified ?? []).flatMap((c) => (c.interestCategoryId ? [c.interestCategoryId] : [])))], pairs: (costs?.identified ?? []).flatMap((c) => (c.interestCategoryId ? [{ accountId: c.accountId, categoryId: c.interestCategoryId }] : [])), name: "Credit card interest" },
    { key: "fees", label: "Fees", colour: PARTS.fees, values: costs ? costSum(costs.fees) : [], categoryIds: [...new Set((costs?.identified ?? []).flatMap((c) => (c.feeCategoryId ? [c.feeCategoryId] : [])))], pairs: (costs?.identified ?? []).flatMap((c) => (c.feeCategoryId ? [{ accountId: c.accountId, categoryId: c.feeCategoryId }] : [])), name: "Credit card fees" },
  ];
  const costsDrawn = !!costs && costs.identified.length > 0 && costs.months.some((_, i) => costs.interest[i] !== 0 || costs.fees[i] !== 0);
  const costsMessage = costSettings.state === "loading" ? "Reading the card settings…"
    : costSettings.state === "unavailable" ? "Unavailable: the card settings could not be read from the app database."
    : costs && costs.identified.length === 0 ? "No card has an interest or fee category set in Credit Cards, so its interest and fees cannot be told from other spending."
    : "No interest or fees were charged to the cards that have these categories set in this period.";
  const range = (b: { first: string; last: string }) => ({ month: b.first, throughMonth: b.last !== b.first ? b.last : undefined });
  const partialNote = (names: { one: string; many: string }, unit: Granularity, partials: number[], names2: string[]) => (partials.length === 0 ? ""
    : unit === "month" ? `* ${names2[partials[0]]} is partial: it runs to ${formatDay(period.endDate)} and is drawn lighter with a dashed outline.`
    : `* ${partials.map((i) => names2[i]).join(" and ")} ${partials.length === 1 ? "is" : "are"} partial: the period covers only part of ${partials.length === 1 ? "it" : "them"}, or ${partials.length === 1 ? "it includes" : "they include"} the month still running, so ${partials.length === 1 ? "it is" : "they are"} drawn lighter with a dashed outline and not compared with whole ${names.many}.`);
  const cardPartialNote = cardPartial === null ? "" : cardMonths.partial !== null ? `* ${cardLabels[cardPartial]} is the balance today (it runs to ${formatDay(period.endDate)}), drawn lighter with a dashed outline.` : `* ${cardLabels[cardPartial]} is the balance at ${formatDay(period.endDate)}, the end of the period, not the end of the ${balNames.one}.`;
  const payPartialNote = partialNote(payNames, payUnit, payPartials, labels);
  const costPartialNote = partialNote(costNames, costUnit, costPartials, costLabels);

  // ── The table ──
  const nextText = (r: DebtAccountRow) => (r.next12?.state === "scheduled" ? r.next12.principalMinor : r.next12?.state === "review" ? "Review in Loans" : r.next12 ? "Not scheduled" : "");
  // Loan columns only when there is a loan: no empty columns. The share column is a picture of the End column, so it is not in the CSV.
  const head = [HEAD[0], ...HEAD.slice(1, 4), ...(hasLoans ? HEAD.slice(4, 7) : [])];
  const csv = rows.map((r) => [r.name, r.startMinor, r.endMinor, r.changeMinor, ...(hasLoans ? [r.principalRepaidMinor, nextText(r) === "" ? null : nextText(r), r.next12?.state === "scheduled" ? r.next12.laterMinor : null] : [])]);
  const group = (key: DebtGroup) => rows.filter((r) => r.group === key);
  // What you owe, by group: a share of the positive balances (a loan in credit is not a share).
  const owedTotal = rows.reduce((a, r) => a + Math.max(0, r.endMinor), 0);
  const groupOwed = (key: DebtGroup) => group(key).reduce((a, r) => a + Math.max(0, r.endMinor), 0);
  const showShare = owedTotal > 0;
  const pct = (part: number) => `${((part / owedTotal) * 100).toFixed(part / owedTotal >= 0.1 ? 0 : 1)}%`;
  const shareCell = (part: number) => (
    <td className="py-1.5 pr-2 text-right whitespace-nowrap">
      {part > 0 ? <span className="inline-flex items-center justify-end gap-1.5 tabular-nums"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden><span className="block h-full rounded-full bg-muted-foreground/50" style={{ width: `${Math.max(2, (part / owedTotal) * 100)}%` }} /></span><span className="w-9 text-muted-foreground">{pct(part)}</span></span> : ""}
    </td>
  );
  const columns = 4 + (showShare ? 1 : 0) + (hasLoans ? 3 : 0);

  return (
    <div className="space-y-4 p-4">
      <section className="space-y-4" aria-label="What you owe">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Tile label="You owe" detail={<>{signedMoney(summary.liabilities - owedAtStart)} during the period<span className="block">Loans, cards and other liabilities</span></>}>{money(summary.liabilities)}</Tile>
          {DEBT_GROUPS.map(({ key, label }) => {
            const inGroup = group(key);
            const sub = debtTotals(inGroup);
            return (
              <Tile key={key} label={label} detail={inGroup.length === 0 ? `No ${key === "loans" ? "loan" : key === "cards" ? "credit card" : "other liability"} accounts` : <>{signedMoney(sub.changeMinor)} during the period{owedTotal > 0 && groupOwed(key) > 0 && <span className="block">{pct(groupOwed(key))} of what you owe</span>}</>}>
                {inGroup.length === 0 ? "None" : money(sub.endMinor)}
              </Tile>
            );
          })}
          <Tile label="Interest & fees paid" tone={hasLoans && !debt.complete ? "warning" : undefined}
            detail={!hasLoans && !hasCards ? "No loans or credit cards" : (
              <>
                {hasLoans && <>Loans {money(loanCost)}</>}{hasLoans && hasCards && " · "}{hasCards && <>cards {cardCost === null ? "need categories in Credit Cards" : money(cardCost)}</>}
                {hasLoans && !debt.complete && <span className="block">Excludes loans not tracked in Loans</span>}
              </>
            )}>
            {!hasLoans && !hasCards ? "None" : money(loanCost + (cardCost ?? 0))}
          </Tile>
        </div>

      </section>

      {hasLoans && (
        <section className="space-y-4" aria-label="Your loans">
          <div className={drawn ? "grid items-stretch gap-4 xl:grid-cols-2" : "grid gap-4"}>
            {drawn && (
              <ChartFrame
                id="loan-payments" title="What your loan payments did" hint={`Principal, interest and fees by ${payNames.one}`}
                subtitle={<><p>Each {payNames.one}&apos;s recorded payments into your loans. Principal lowers what you owe and is not spending; interest and fees are spending already counted in Spending.{payUnit !== "month" && ` A ${payNames.one} adds up its months; it is a calendar ${payNames.one}, and one the period only partly covers is marked *.`}</p><p>Interest and fees come only from loans tracked in Loans. A loan that is not tracked shows principal only: its interest and fees cannot be told from other spending.</p><p>Select a segment to see its transactions.</p></>}
                legend={series.map((s) => ({ label: s.label, colour: s.colour }))}
                actions={<UnitPills value={payUnit} onChange={setPayUnit} label="Show loan payments by" />}
                table={{ head: [payNames.one[0].toUpperCase() + payNames.one.slice(1), "Principal", "Interest", "Fees"], rows: payBuckets.map((b, i) => [labels[i] + (b.partial ? " (partial)" : ""), ...series.map((s) => s.values[i])]) }} csvScope={scope}
                footnote={[
                  untracked.length > 0 ? `Interest and fees of ${untracked.map((r) => r.name).join(", ")} are not identified: ${untracked.length === 1 ? "it is" : "they are"} not tracked in Loans, so only principal is drawn.` : "",
                  payPartialNote,
                ].filter(Boolean).join(" ") || undefined}
              >
                <BarChart labels={labels} partialIndex={payPartials.length ? payPartials : null} stacked height={290} ariaLabel={`Principal, interest and fees paid into loans in each ${payNames.one}`} series={series}
                  tip={(i) => monthTip({
                    title: labels[i], partial: payBuckets[i].partial, partialNote: payUnit === "month" ? `Partial month: it runs to ${formatDay(period.endDate)}.` : `Partial ${payNames.one}: the period covers only part of it, or it includes the month still running.`,
                    rows: [...series.map((s) => ({ colour: s.colour, name: s.label, value: money(s.values[i]) })), { name: <span className="font-semibold">Paid in the {payNames.one}</span>, value: <span className="font-semibold">{money(payBuckets[i].hasData ? series.reduce((total, s) => total + (s.values[i] ?? 0), 0) : null)}</span> }],
                  })}
                  onSelect={(i, k) => { const s = series[k]; if (s && payBuckets[i]?.hasData) onDrill({ kind: s.drill, ...range(payBuckets[i]) }); }} />
              </ChartFrame>
            )}
            <DebtRepaymentsCard data={data} csvScope={scope} upcoming={upcoming} />
          </div>
        </section>
      )}

      {hasCards && (
        <section className="space-y-4" aria-label="Your credit cards">
          <div className="grid items-stretch gap-4 xl:grid-cols-2">
            <ChartFrame
              id="card-balances" title="What you owe on credit cards" hint={`Balance at each ${balNames.one} end, by card`}
              subtitle={<><p>What you owe on each credit card at the end of each {balNames.one}, from the same balances as the table, with the total as a line. The five largest cards have a colour of their own and the rest are &quot;Other cards&quot;.{balUnit !== "month" && ` A ${balNames.one} is a calendar ${balNames.one}, shown by its last month's balance.`}</p><p>A card balance is what Actual says is owed; it is not a statement amount.</p></>}
              legend={[...cardSeries.map((c) => ({ label: c.label, colour: c.colour })), { label: "Total", colour: "var(--fi-networth)", line: true }]}
              actions={<UnitPills value={balUnit} onChange={setBalUnit} label="Show card balances by" />}
              table={{ head: [balNames.one[0].toUpperCase() + balNames.one.slice(1), ...cardMonths.cards.map((c) => c.name), "Total"], rows: balBuckets.map((b, i) => [cardLabels[i] + (cardPartial === i ? (cardMonths.partial !== null ? " (today)" : ` (to ${monthLabel(b.last)})`) : ""), ...cardTable.map((c) => c[i]), cardTotals[i]]) }} csvScope={scope}
              footnote={[cardMonths.cards.some((c) => c.values.some((v) => v !== null && v < 0)) ? "A card in credit (paid more than it was charged) is drawn below zero." : "", cardPartialNote].filter(Boolean).join(" ") || undefined}
            >
              <BarChart labels={cardLabels} partialIndex={cardPartial} stacked height={290} ariaLabel={`What you owe on each credit card at every ${balNames.one} end`} series={cardSeries}
                overlay={{ label: "Total", colour: "var(--fi-networth)", values: cardTotals }}
                tip={(i) => monthTip({
                  title: cardLabels[i], partial: i === cardPartial, partialNote: cardMonths.partial !== null ? `Balance today: it runs to ${formatDay(period.endDate)}.` : `Balance at the end of the period, not the end of the ${balNames.one}.`,
                  rows: [...cardSeries.map((c) => ({ colour: c.colour, name: c.label, value: money(c.values[i]) })), { name: <span className="font-semibold">Owed on cards</span>, value: <span className="font-semibold">{money(cardTotals[i])}</span> }],
                })} />
            </ChartFrame>
            <ChartFrame
              id="card-costs" title="Interest & fees on credit cards" hint={`Charged in each ${costNames.one}`}
              subtitle={<><p>The interest and fees charged to your credit cards each {costNames.one}: the entries in a card&apos;s account with the interest or fee category set for that card in Credit Cards. They are spending, already counted in Spending.{costUnit !== "month" && ` A ${costNames.one} adds up its months; it is a calendar ${costNames.one}, and one the period only partly covers is marked *.`}</p><p>A card with neither category set is not identified: its interest and fees cannot be told from other purchases, so none is guessed. Select a bar to see its transactions.</p></>}
              legend={costParts.map((c) => ({ label: c.label, colour: c.colour }))}
              actions={<UnitPills value={costUnit} onChange={setCostUnit} label="Show interest and fees by" />}
              table={{ head: [costNames.one[0].toUpperCase() + costNames.one.slice(1), "Interest", "Fees"], rows: costs ? costBuckets.map((b, i) => [costLabels[i] + (b.partial ? " (partial)" : ""), costParts[0].values[i], costParts[1].values[i]]) : [] }} csvScope={scope}
              footnote={[costs && costs.notIdentified.length > 0 && costs.identified.length > 0 ? `Not identified, because no interest or fee category is set in Credit Cards: ${costs.notIdentified.map((c) => c.name).join(", ")}.` : "", costsDrawn ? costPartialNote : ""].filter(Boolean).join(" ") || undefined}
            >
              {costsDrawn && costs ? (
                <BarChart labels={costLabels} partialIndex={costPartials.length ? costPartials : null} stacked height={290} ariaLabel={`Interest and fees charged to credit cards in each ${costNames.one}`} series={costParts}
                  tip={(i) => monthTip({
                    title: costLabels[i], partial: costBuckets[i].partial, partialNote: costUnit === "month" ? `Partial month: it runs to ${formatDay(period.endDate)}.` : `Partial ${costNames.one}: the period covers only part of it, or it includes the month still running.`,
                    rows: [...costParts.map((c) => ({ colour: c.colour, name: c.label, value: money(c.values[i]) })), { name: <span className="font-semibold">Charged in the {costNames.one}</span>, value: <span className="font-semibold">{money(costBuckets[i].hasData ? (costParts[0].values[i] ?? 0) + (costParts[1].values[i] ?? 0) : null)}</span> }],
                  })}
                  onSelect={(i, k) => { const c = costParts[k]; const amount = c?.values[i]; if (c && costBuckets[i].hasData && amount != null && c.categoryIds.length > 0) onDrill({ kind: "category", categoryIds: c.categoryIds, pairs: c.pairs, name: c.name, amountMinor: amount, ...range(costBuckets[i]) }); }} />
              ) : (
                <p className="py-16 text-center text-xs text-muted-foreground" role="status">{costsMessage}{costSettings.state === "ready" && costs && costs.identified.length === 0 && <> <Link href="/credit-cards" className="underline underline-offset-2">Open Credit Cards</Link>.</>}</p>
              )}
            </ChartFrame>
          </div>
        </section>
      )}

      {onOpenAssets && (
        <p className="text-xs text-muted-foreground">
          Property equity and loan-to-value are on <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onOpenAssets}>Property &amp; assets</button>.
        </p>
      )}

      <TableCard collapsible id="what-you-owe" title="What you owe, account by account" hint="Balances are Actual's" csvScope={scope}
        info={<><p><span className="font-medium text-foreground">Balance</span> is what Actual says is owed now. <span className="font-medium text-foreground">Principal due</span> is the part of the scheduled payments of the next twelve months that lowers a loan: a schedule as of today, not a total on top of the balance. <span className="font-medium text-foreground">Payments</span>: principal lowers what you owe and is not spending; interest and fees are spending; paying a card settles purchases already counted.</p><p>A loan is counted at its full balance. Nothing is estimated: a loan that is not tracked in Loans has no schedule here.</p><p>Every loan, credit card and other liability, with what was owed at the start and the end of the period. Principal repaid is what was paid into the loan in the period.</p><p><span className="font-medium text-foreground">Next 12 months</span> and <span className="font-medium text-foreground">Later</span> are as of today, whatever period is selected: the scheduled principal of the coming twelve months, and what is owed today after it. Only a loan tracked in Loans, whose schedule agrees with its account, has them.</p></>}
        head={head} rows={csv}
        note={<>
          {totals.scheduledLoans > 0 && totals.loans > totals.scheduledLoans && <span>Next 12 months and Later add up only the {totals.scheduledLoans} of {totals.loans} loans that have a schedule. </span>}
          Accounts with no balance and no activity in the period are not listed.
        </>}>
        {showShare && (
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground" aria-label="What you owe by group">
            {DEBT_GROUPS.filter((g) => groupOwed(g.key) > 0).map((g) => <li key={g.key} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ backgroundColor: GROUP_COLOUR[g.key] }} aria-hidden />{g.label}<span className="tabular-nums text-foreground">{money(groupOwed(g.key))}</span>{pct(groupOwed(g.key))}</li>)}
          </ul>
        )}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">{HEAD[0]}</th>
              {HEAD.slice(1, 4).map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
              {showShare && <th scope="col" className={TH} title="Each account's part of everything you owe at the end of the period">Share</th>}
              {hasLoans && HEAD.slice(4, 7).map((h) => <th key={h} scope="col" className={TH} title={h === "Next 12 months" || h === "Later" ? "From the saved loan schedules, as of today, whatever period is selected" : undefined}>{h}{h === "Next 12 months" || h === "Later" ? "*" : ""}</th>)}
            </tr>
          </thead>
          <tbody>
            {DEBT_GROUPS.flatMap(({ key, label }) => {
              const inGroup = group(key);
              if (inGroup.length === 0) return [];
              const sub = debtTotals(inGroup);
              const isOpen = !closed.has(key);
              return [
                <tr key={key} className="border-b border-border/60 bg-muted/40 font-medium">
                  <th scope="rowgroup" className="py-1.5 pr-2 text-left">
                    <span className="flex items-center gap-3 whitespace-nowrap">
                      <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${label}`} className="-ml-1 flex items-center gap-1.5 rounded px-1 hover:bg-muted" onClick={() => toggle(key)}>
                        <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: GROUP_COLOUR[key] }} aria-hidden />{label}
                      </button>
                      {key === "cards" && <Link href="/credit-cards" className="text-xs font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground">View credit cards</Link>}
                    </span>
                  </th>
                  <td className={TD}>{money(sub.startMinor)}</td><td className={TD}>{money(sub.endMinor)}</td><td className={TD}>{signedMoney(sub.changeMinor)}</td>
                  {showShare && shareCell(groupOwed(key))}
                  {hasLoans && <>
                    <td className={TD}>{key === "loans" ? money(sub.principalRepaidMinor) : ""}</td>
                    <td className={TD}>{key === "loans" ? (sub.scheduledLoans === 0 ? "" : money(sub.principalNext12Minor)) : ""}</td>
                    <td className={TD}>{key === "loans" && sub.scheduledLoans > 0 ? money(inGroup.reduce((a, r) => a + (r.next12?.state === "scheduled" ? r.next12.laterMinor : 0), 0)) : ""}</td>
                  </>}
                </tr>,
                ...(isOpen ? inGroup.map((r) => (
                  <tr key={r.accountId} className="border-b border-border/40">
                    <th scope="row" className="max-w-56 py-1.5 pr-2 pl-8 text-left font-normal whitespace-nowrap"><span className="block truncate" title={r.name}>{r.name}</span></th>
                    <td className={TD}>{money(r.startMinor)}</td>
                    <td className={`${TD} font-medium`}>{money(r.endMinor)}</td>
                    <td className={TD}>{signedMoney(r.changeMinor)}</td>
                    {showShare && shareCell(Math.max(0, r.endMinor))}
                    {hasLoans && <>
                      <td className={TD}>{r.principalRepaidMinor === null ? "" : link(r.principalRepaidMinor, { kind: "loanPrincipal", accountId: r.accountId }, `${r.name} principal repaid`)}</td>
                      <td className={TD}>
                        {r.next12?.state === "scheduled" ? money(r.next12.principalMinor)
                          : r.next12?.state === "review" ? <Link href="/loans" className={`${WARNING} underline underline-offset-2`} title={r.next12.reason}>Review in Loans</Link>
                          : r.next12 ? <Link href="/loans" className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground" title="This loan is not tracked in Loans, so nothing is scheduled and nothing is estimated. Open Loans to track it.">Not scheduled</Link> : ""}
                      </td>
                      <td className={TD}>{r.next12?.state === "scheduled" ? money(r.next12.laterMinor) : r.next12 ? MISSING : ""}</td>
                    </>}
                  </tr>
                )) : []),
              ];
            })}
            <tr className="font-semibold">
              <th scope="row" className="py-1.5 pr-2 text-left">You owe</th>
              <td className={TD}>{money(totals.startMinor)}</td><td className={TD}>{money(totals.endMinor)}</td><td className={TD}>{signedMoney(totals.changeMinor)}</td>{columns > 4 && <td colSpan={columns - 4} />}
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-muted-foreground">* From the saved loan schedules, as of today, not of the end of the period. Credit cards and other liabilities have no schedule here.</p>
      </TableCard>
    </div>
  );
}
