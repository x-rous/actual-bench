"use client";

import { Fragment, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { downloadCsv } from "@/lib/csv";
import { buildBalanceSheet, type BalanceSheetGroup } from "@/lib/financial-insights/balanceSheet";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import type { AccountFact, Ledger } from "@/lib/financial-insights/measures";
import { addMonths } from "@/lib/financial-insights/period";
import { statementsCsvRows, subtotalIds, type StatementGroup, type StatementLine, type Statements } from "@/lib/financial-insights/statements";
import type { ReadyData } from "../hooks/useFinancialInsights";
import { useStatements } from "../hooks/useStatements";
import { formatDay, money, signedMoney } from "../format";
import { DrillLink } from "./DrillLink";
import { LoadingState } from "./LoadingState";
import { TableCard } from "./TableCard";
import { InfoTip } from "./InfoTip";

type Props = { data: ReadyData; onDrill: (target: DrillTarget) => void };
type OpenLine = (row: StatementLine) => void;

// Keep the same type scale in each statement: rows, section headings and final totals.
const STATEMENT_ROW = "font-sans text-xs";
const STATEMENT_HEADING = "font-sans text-xs font-semibold";
const STATEMENT_TOTAL = "font-sans text-sm font-semibold";
function Figure({ row, onOpen, neutral = false }: { row: StatementLine; onOpen: OpenLine; neutral?: boolean }) {
  const colour = neutral ? "text-foreground hover:text-foreground" : row.amountMinor > 0 ? "text-emerald-700 dark:text-emerald-400" : row.amountMinor < 0 ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground";
  return row.ids.length ? <DrillLink className={colour} label={`${row.label} ${signedMoney(row.amountMinor)}`} onClick={() => onOpen(row)}>{signedMoney(row.amountMinor)}</DrillLink> : <span className={`tabular-nums ${colour}`}>{signedMoney(row.amountMinor)}</span>;
}

function Rows({ rows, onOpen, explanations = false }: { rows: StatementLine[]; onOpen: OpenLine; explanations?: boolean }) {
  return <table className={`w-full ${STATEMENT_ROW}`}><thead className="sr-only"><tr><th scope="col">Line</th><th scope="col">Amount</th></tr></thead><tbody>
    {rows.map((row, index) => <tr key={JSON.stringify([row.key, index])} className="border-b border-border/40 last:border-b-0 hover:bg-muted/30">
      <th scope="row" className="py-1 pl-5 pr-3 text-left font-normal"><span className="inline-flex items-center gap-1">{row.label}{row.detail && !explanations && <InfoTip label={row.label}>{row.detail}</InfoTip>}</span>{row.detail && explanations && <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{row.detail}</span>}</th>
      <td className="py-1 pr-3 text-right align-top whitespace-nowrap"><Figure row={row} onOpen={onOpen} /></td>
    </tr>)}
  </tbody></table>;
}

function Total({ label, amountMinor, rows, onOpen, strong = false, neutral = false }: { label: string; amountMinor: number; rows?: StatementLine[]; onOpen: OpenLine; strong?: boolean; neutral?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 px-3 text-xs font-semibold ${strong ? `border-t border-border bg-muted/60 py-3 ${STATEMENT_TOTAL} text-foreground` : "border-t border-border/60 bg-muted/30 py-2 text-foreground"}`}>
    <span>{label}</span><Figure neutral={neutral} row={{ key: label, label, amountMinor, ids: rows ? subtotalIds(rows) : [] }} onOpen={onOpen} />
  </div>;
}

function Categories({ groups, onOpen, expanded, setExpanded, prefix }: { groups: StatementGroup[]; onOpen: OpenLine; expanded: ReadonlySet<string>; setExpanded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>; prefix: string }) {
  if (!groups.length) return <p className="py-2 pl-5 text-xs text-muted-foreground">No income or expense entries in this period.</p>;
  return <table className={`w-full table-fixed ${STATEMENT_ROW}`}>
    <colgroup><col /><col className="w-36" /></colgroup>
    <thead className="sr-only"><tr><th scope="col">Group / category</th><th scope="col">Amount</th></tr></thead>
    <tbody>{groups.map((group) => {
      const groupKey = JSON.stringify([prefix, group.key]);
      const isOpen = expanded.has(groupKey);
      return <Fragment key={group.key}>
        <tr className="border-b border-border/40 last:border-b-0 hover:bg-muted/30">
          <th scope="row" className="py-0.5 pl-4 pr-2 text-left font-normal">
            <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${group.label}, ${group.rows.length} ${group.rows.length === 1 ? "category" : "categories"}`} title={group.label}
              className="-ml-1 flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setExpanded((current) => { const next = new Set(current); if (!next.delete(groupKey)) next.add(groupKey); return next; })}>
              <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden /><span className="truncate font-medium capitalize">{group.label}</span>
            </button>
          </th>
          <td className="py-1 pr-3 text-right whitespace-nowrap"><Figure neutral row={group} onOpen={onOpen} /></td>
        </tr>
        {isOpen && group.rows.map((row) => <tr key={row.key} className="border-b border-border/30 last:border-b-0 bg-muted/20">
          <th scope="row" className="truncate py-1 pl-10 pr-2 text-left font-normal text-muted-foreground" title={row.label}>{row.label}</th>
          <td className="py-1 pr-3 text-right whitespace-nowrap"><Figure neutral row={row} onOpen={onOpen} /></td>
        </tr>)}
      </Fragment>;
    })}</tbody>
  </table>;
}

/** The header, indented lines and subtotal belong to one visible statement section. */
const SECTION_TONES = {
  cash: "bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  investing: "bg-indigo-50 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200",
  financing: "bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200",
  income: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  expenses: "bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
  warning: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
} as const;

function StatementSection({ title, children, total, headerTotal, tone = "cash" }: { title: string; children: ReactNode; total?: ReactNode; headerTotal?: ReactNode; tone?: keyof typeof SECTION_TONES }) {
  return <section aria-label={title}>
    <h3 className={`flex items-center justify-between gap-3 px-3 py-2 ${STATEMENT_HEADING} ${SECTION_TONES[tone]}`}><span className="capitalize">{title}</span>{headerTotal}</h3>
    <div>{children}</div>
    {total}
  </section>;
}

function Headline({ figures, cashBreakdown = false, pnlTotals = false }: { figures: [string, number | null][]; cashBreakdown?: boolean; pnlTotals?: boolean }) {
  return <dl className="mb-4 grid grid-cols-3 gap-3 border-b border-border pb-4">
    {figures.map(([label, amount], index) => <div key={label} className={`min-w-0 ${index === 2 ? "border-l-2 border-sky-500/60 pl-3" : ""}`}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className={`mt-1 font-semibold tabular-nums ${`${index === 2 ? "text-lg" : "text-base"} ${pnlTotals ? amount === null ? "" : index === 1 ? "text-rose-700 dark:text-rose-400" : amount < 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400" : index === 2 ? "text-sky-800 dark:text-sky-300" : ""}`} ${amount === null ? "text-amber-800 dark:text-amber-400" : ""}`}>{cashBreakdown && (index === 0 || index === 2) ? <DialogTrigger render={<button type="button" className="rounded-sm text-left underline decoration-muted-foreground/60 underline-offset-4 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${label}: ${money(amount)}. Show cash accounts`} />} >{money(amount)}</DialogTrigger> : amount === null ? "Needs review" : money(amount)}</dd></div>)}
  </dl>;
}

function BalanceSheetGroups({ groups, empty, expanded, setExpanded, closed, setClosed }: { groups: BalanceSheetGroup[]; empty: string; expanded: ReadonlySet<string>; setExpanded: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>; closed: ReadonlySet<string>; setClosed: React.Dispatch<React.SetStateAction<ReadonlySet<string>>> }) {
  if (!groups.length) return <p className="px-3 py-2 text-xs text-muted-foreground">{empty}</p>;
  return <div className="space-y-3">{groups.map((group) => {
    const accountGroups = new Map<string | null, { name: string; rows: typeof group.rows }>();
    for (const row of group.rows) {
      const accountGroup = accountGroups.get(row.groupId) ?? { name: row.groupName, rows: [] };
      accountGroup.rows.push(row);
      accountGroups.set(row.groupId, accountGroup);
    }
    const orderedGroups = [...accountGroups.entries()].sort(([a], [b]) => a === null ? 1 : b === null ? -1 : 0);
    const isSectionOpen = !closed.has(group.key);
    return <section key={group.key}>
      <button type="button" aria-expanded={isSectionOpen} className={`flex w-full items-center justify-between gap-3 bg-muted/40 px-3 py-2 text-left ${STATEMENT_HEADING} hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`} onClick={() => setClosed((current) => { const next = new Set(current); if (!next.delete(group.key)) next.add(group.key); return next; })}><span className="flex items-center gap-1"><ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isSectionOpen ? "rotate-90" : ""}`} aria-hidden /><span className="capitalize">{group.label}</span></span><span className="tabular-nums">{money(group.amountMinor)}</span></button>
      {isSectionOpen && <div>{orderedGroups.map(([id, accountGroup]) => {
        const key = JSON.stringify([group.key, id]);
        const isOpen = expanded.has(key);
        return <section key={id ?? "ungrouped"} className="border-b border-border/40 last:border-b-0">
          <button type="button" aria-expanded={isOpen} className="flex w-full items-center justify-between gap-3 bg-muted/20 py-1.5 pr-3 pl-6 text-left font-sans text-xs font-medium text-muted-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => setExpanded((current) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; })}><span className="flex items-center gap-1"><ChevronRight className={`size-4 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden /><span className="capitalize">{accountGroup.name}</span></span><span className="tabular-nums whitespace-nowrap">{money(accountGroup.rows.reduce((sum, row) => sum + row.amountMinor, 0))}</span></button>
          {isOpen && <table className={`w-full table-fixed ${STATEMENT_ROW}`}><colgroup><col className="w-[45%]" /><col className="w-[35%]" /><col className="w-[20%]" /></colgroup><thead className="sr-only"><tr><th scope="col">Account</th><th scope="col">Financial Reporting</th><th scope="col">Balance</th></tr></thead><tbody>{accountGroup.rows.map((row) => <tr key={row.id} className="border-b border-border/40 last:border-b-0"><th scope="row" className="py-1 pl-12 pr-3 text-left font-normal break-words">{row.name}{row.closed ? " (closed)" : ""}</th><td className="px-3 py-1 text-left text-muted-foreground break-words">{row.reporting}</td><td className="py-1 pr-3 text-right tabular-nums whitespace-nowrap">{money(row.amountMinor)}</td></tr>)}</tbody></table>}
        </section>;
      })}</div>}
    </section>;
  })}</div>;
}

function CashAccountBreakdown({ accounts, ledger, before, endMonth, openingMinor, closingMinor }: { accounts: readonly AccountFact[]; ledger: Ledger; before: string; endMonth: string; openingMinor: number; closingMinor: number }) {
  const [closedClasses, setClosedClasses] = useState<ReadonlySet<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const classes = (["cash", "bank"] as const).map((key) => ({ key, label: key === "cash" ? "Cash" : "Bank", accounts: accounts.filter((a) => a.accountClass === key) })).filter((group) => group.accounts.length);
  const groupKey = (classKey: string, id: string | null | undefined) => JSON.stringify([classKey, id ?? null]);
  const toggle = (setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>, key: string) => setter((current) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; });
  const sum = (items: readonly AccountFact[], month: string) => items.reduce((total, account) => total + ledger.balanceAt(account.id, month), 0);
  return <>
    <div className="flex justify-end gap-1"><Button variant="ghost" size="xs" onClick={() => { setClosedClasses(new Set()); setExpandedGroups(new Set(classes.flatMap((group) => group.accounts.map((a) => groupKey(group.key, a.groupId))))); }}>Expand all</Button><Button variant="ghost" size="xs" onClick={() => setExpandedGroups(new Set())}>Collapse all</Button></div>
    <div className="min-h-0 overflow-auto"><table className="w-full table-fixed text-xs"><colgroup><col className="w-[50%]" /><col className="w-1/4" /><col className="w-1/4" /></colgroup><thead><tr className="border-b border-border"><th scope="col" className="py-2 text-left">Account</th><th scope="col" className="py-2 text-right">Opening cash</th><th scope="col" className="py-2 text-right">Closing cash</th></tr></thead>
      {classes.map((accountClass) => {
        const isOpen = !closedClasses.has(accountClass.key);
        const groups = new Map<string | null, { name: string; accounts: AccountFact[] }>();
        for (const account of accountClass.accounts) {
          const id = account.groupId ?? null;
          const group = groups.get(id) ?? { name: id ? account.groupName ?? "Group unavailable" : "No Group", accounts: [] };
          group.accounts.push(account); groups.set(id, group);
        }
        const ordered = [...groups.entries()].sort(([a], [b]) => a === null ? 1 : b === null ? -1 : 0);
        return <tbody key={accountClass.key}><tr className="border-b border-border bg-muted/40 font-semibold"><th scope="row" className="text-left"><button type="button" aria-expanded={isOpen} onClick={() => toggle(setClosedClasses, accountClass.key)} className="flex w-full items-center gap-1 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><ChevronRight className={`size-4 shrink-0 ${isOpen ? "rotate-90" : ""}`} aria-hidden />{accountClass.label}</button></th><td className="text-right tabular-nums">{money(sum(accountClass.accounts, before))}</td><td className="text-right tabular-nums">{money(sum(accountClass.accounts, endMonth))}</td></tr>
          {isOpen && ordered.map(([id, group]) => { const key = groupKey(accountClass.key, id); const open = expandedGroups.has(key); return <Fragment key={key}>
            <tr className="border-b border-border/40 bg-muted/20"><th scope="row" className="text-left"><button type="button" aria-expanded={open} onClick={() => toggle(setExpandedGroups, key)} className="flex w-full items-center gap-1 py-2 pl-5 text-left font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><ChevronRight className={`size-4 shrink-0 ${open ? "rotate-90" : ""}`} aria-hidden />{group.name}</button></th><td className="text-right tabular-nums">{money(sum(group.accounts, before))}</td><td className="text-right tabular-nums">{money(sum(group.accounts, endMonth))}</td></tr>
            {open && group.accounts.map((account) => <tr key={account.id} className="border-b border-border/40"><th scope="row" className="py-2 pl-10 pr-2 text-left font-normal break-words">{account.name}{account.closed ? " (closed)" : ""}</th><td className="text-right tabular-nums">{money(ledger.balanceAt(account.id, before))}</td><td className="text-right tabular-nums">{money(ledger.balanceAt(account.id, endMonth))}</td></tr>)}
          </Fragment>; })}
        </tbody>;
      })}<tfoot><tr className="font-semibold"><th scope="row" className="py-2 text-left">Total cash equivalents</th><td className="text-right tabular-nums">{money(openingMinor)}</td><td className="text-right tabular-nums">{money(closingMinor)}</td></tr></tfoot></table></div>
  </>;
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return <span className={`inline-flex items-center gap-1.5 text-xs ${ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-800 dark:text-amber-400"}`}><Icon className="size-3.5 shrink-0" aria-hidden />{children}</span>;
}

/** Shares the global period and snapshot; transaction evidence is fetched only for this view. */
export function StatementsTab({ data, onDrill }: Props) {
  const { model, isError, retry } = useStatements(data);
  if (isError) return <div role="alert" className="space-y-3 p-6"><p className="text-sm">The statement transactions could not be read completely. No partial statement is shown.</p><Button variant="outline" size="sm" onClick={retry}>Retry statements</Button></div>;
  if (!model) return <LoadingState title="Reading statement evidence…" detail="Reading recorded transactions and split lines for the reporting period" />;
  return <StatementsContent data={data} model={model} onDrill={onDrill} />;
}

/** Presentation is separate so financial invariants and the rendered statements can be verified from the same fixture. */
export function StatementsContent({ data, model, onDrill }: Props & { model: Statements }) {
  const [expandedCategories, setExpandedCategories] = useState<ReadonlySet<string>>(new Set());
  const [expandedAccounts, setExpandedAccounts] = useState<ReadonlySet<string>>(new Set());
  const [closedBalanceSections, setClosedBalanceSections] = useState<ReadonlySet<string>>(new Set());
  const { period, ledger } = data;
  const { cash, pnl } = model;
  const open: OpenLine = (row) => onDrill({ kind: "statement", name: row.label, ids: row.drill?.ids ?? row.ids, amountMinor: row.drill?.amountMinor ?? row.amountMinor, description: row.detail });
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["Basis", "Recorded categories; uncategorized on-budget receipts/payments by sign; investment activity separate"], ["Classification", model.classificationComplete ? "Complete" : "Needs review"], ["P&L status", pnl.basisIssue ?? "Recorded result"]];
  const csv = statementsCsvRows(model, period);
  const csvRows = (statement: string) => csv.filter((r) => r[0] === statement).map((r) => r.slice(1).map(String));
  const before = addMonths(period.startMonth, -1);
  const balanceSheet = buildBalanceSheet(ledger, period.endMonth);
  const balanceGroups = [...balanceSheet.assets, ...balanceSheet.liabilities];
  const categoryKeys = [...pnl.income.map((group) => JSON.stringify(["income", group.key])), ...pnl.expenses.map((group) => JSON.stringify(["expenses", group.key]))];
  const accountGroupKeys = balanceGroups.flatMap((group) => group.rows.map((row) => JSON.stringify([group.key, row.groupId])));
  const cashAccounts = ledger.facts.accounts.filter((a) => ledger.role.get(a.id) === "cash");
  return <div className="space-y-4 p-4 font-sans">
    <div className="grid grid-cols-2 items-stretch gap-4" data-testid="statements-pair">
      <Dialog><TableCard id="cash-flow-statement" title="Cash Flow Statement" hint="Cash movements" info="Cash and Bank cash-equivalent accounts, on or off budget. Fixed / restricted deposits are outside cash. Ordinary card settlements are operating; unidentified purposes are separate." head={["Section", "Line", "Amount", "Entries", "Explanation"]} rows={csvRows("Cash flow")} csvScope={scope} footer={<Total strong label={cash.changeMinor < 0 ? "Net decrease in cash" : "Net increase in cash"} amountMinor={cash.changeMinor} onOpen={open} />}
        note={<div className="space-y-1"><Status ok={cash.differenceMinor === 0}>{cash.differenceMinor === 0 ? "Balances reconcile" : "Balances do not reconcile"}</Status><p>{money(cash.openingMinor)} + ({signedMoney(cash.changeMinor)}) = {money(cash.closingMinor)}</p><p>Unclassified movements and starting balances are included in this identity, separately from the three activity subtotals.</p></div>}>
        <div className="space-y-3 pt-2">
          <Headline cashBreakdown figures={[["Opening cash", cash.openingMinor], ["Net cash movement", cash.changeMinor], ["Closing cash", cash.closingMinor]]} />
          {cash.sections.map((section) => <StatementSection key={section.key} title={section.label} tone={section.key === "investing" ? "investing" : section.key === "financing" ? "financing" : "cash"} total={<Total label={`Net cash from ${section.label.toLowerCase()}`} amountMinor={section.amountMinor} rows={section.rows} onOpen={open} />}>{section.rows.length ? <Rows rows={section.rows} onOpen={open} /> : <p className="py-2 pl-5 pr-3 text-xs text-muted-foreground">No identified activity in this period.</p>}</StatementSection>)}
          {cash.adjustments.length > 0 && <StatementSection title="Unclassified movements and adjustments" tone="warning" total={<Total label="Net unclassified movements and adjustments" amountMinor={cash.adjustments.reduce((sum, row) => sum + row.amountMinor, 0)} rows={cash.adjustments} onOpen={open} />}><Rows rows={cash.adjustments} onOpen={open} /></StatementSection>}
          {cash.differenceMinor !== 0 && <Total label="Unexplained difference" amountMinor={cash.differenceMinor} onOpen={open} />}
        </div>
      </TableCard>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader className="pr-8"><DialogTitle>Which accounts form cash?</DialogTitle><DialogDescription>Opening and closing balances for cash-equivalent accounts, including closed-account history. Fixed / restricted deposits are excluded.</DialogDescription></DialogHeader>
        <CashAccountBreakdown accounts={cashAccounts} ledger={ledger} before={before} endMonth={period.endMonth} openingMinor={cash.openingMinor} closingMinor={cash.closingMinor} />
        <div><Button variant="outline" size="xs" onClick={() => downloadCsv("financial-insights-statement-cash-accounts.csv", [["Financial Insights", "Which accounts form cash?"], ...scope, [], ["Account", "Opening cash", "Closing cash"], ...cashAccounts.map((a) => [a.name + (a.closed ? " (closed)" : ""), (ledger.balanceAt(a.id, before) / 100).toFixed(2), (ledger.balanceAt(a.id, period.endMonth) / 100).toFixed(2)]), ["Total cash equivalents", (cash.openingMinor / 100).toFixed(2), (cash.closingMinor / 100).toFixed(2)]])}>Export CSV</Button></div>
      </DialogContent></Dialog>
      <TableCard actions={categoryKeys.length > 0 && <><Button variant="ghost" size="xs" onClick={() => setExpandedCategories(new Set(categoryKeys))}>Expand all</Button><Button variant="ghost" size="xs" onClick={() => setExpandedCategories(new Set())}>Collapse all</Button></>} id="income-statement" title="Income Statement (P&L)" hint="Recorded income and expenses" info="Uses Actual categories, including hidden categories and recorded card purchases. Uncategorized on-budget entries count by sign in their own income or expense group, as in the Income and Spending tabs. Off-budget Investment / Retirement activity stays separate. Transfers, principal, starting balances and registry-classified asset capital, value changes and sales are excluded." head={["Section", "Line", "Amount", "Entries", "Explanation"]} rows={csvRows("P&L")} csvScope={scope} footer={pnl.basisIssue ? <div role="status" className="border-t border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm font-semibold text-amber-800 dark:text-amber-400">Net surplus / deficit needs review</div> : <Total strong label="Net surplus / deficit" amountMinor={pnl.surplusMinor} rows={[...pnl.income, ...pnl.expenses]} onOpen={open} />}
        note={<div className="space-y-1"><p className="font-medium">Transaction-based reporting</p><p>Categories determine income and expenses; uncategorized on-budget entries count by sign, including card purchases. Off-budget investment activity stays outside P&amp;L. This is not an accrual forecast.</p>{pnl.basisIssue && <p className="text-amber-800 dark:text-amber-400">Needs review: {pnl.basisIssue}. Category totals are provisional.</p>}</div>}>
        <div className="space-y-3 pt-2">
          <Headline pnlTotals figures={[["Income", pnl.incomeMinor], ["Expenses", -pnl.expensesMinor], [pnl.surplusMinor < 0 ? "Net deficit" : "Net surplus", pnl.basisIssue ? null : pnl.surplusMinor]]} />
          <StatementSection title="Total Income" tone="income" headerTotal={<><Figure row={{ key: "total-income", label: "Total Income", amountMinor: pnl.incomeMinor, ids: pnl.income.flatMap((r) => r.ids) }} onOpen={open} /></>}><Categories groups={pnl.income} onOpen={open} expanded={expandedCategories} setExpanded={setExpandedCategories} prefix="income" /></StatementSection>
          <StatementSection title="Total Expenses" tone="expenses" headerTotal={<><Figure row={{ key: "total-expenses", label: "Total Expenses", amountMinor: pnl.expensesMinor, ids: pnl.expenses.flatMap((r) => r.ids) }} onOpen={open} /></>}><Categories groups={pnl.expenses} onOpen={open} expanded={expandedCategories} setExpanded={setExpandedCategories} prefix="expenses" /></StatementSection>
        </div>
      </TableCard>
    </div>
    <div className="grid grid-cols-2 items-start gap-4">
      <div className="space-y-4"><section aria-label="From P&L surplus to cash movement" className="space-y-2 rounded-lg border border-border bg-card p-4"><h3 className="text-sm font-semibold">From P&L surplus to cash movement</h3><p className="text-xs leading-relaxed text-muted-foreground">This bridges the Income Statement surplus or deficit to the Cash Flow Statement net cash movement. Card purchases enter expenses when recorded; settlements change cash later. Noncash income and expenses, investing, financing, and unresolved cash activity explain the rest. Signs below are adjustments to surplus.</p>
        {pnl.basisIssue && <p className="text-xs text-amber-800 dark:text-amber-400">This bridge uses the provisional result while P&amp;L needs review.</p>}
        <dl className="divide-y divide-border/50 text-xs">{model.bridge.filter((r, i) => i === 0 || r.amountMinor !== 0).map((row) => <div key={row.label} className="flex justify-between gap-3 py-2"><dt>{row.label}</dt><dd className="tabular-nums whitespace-nowrap">{signedMoney(row.amountMinor)}</dd></div>)}<div className="flex justify-between gap-3 bg-muted/60 px-3 py-3 font-semibold"><dt>Net cash movement</dt><dd className="tabular-nums">{signedMoney(cash.changeMinor)}</dd></div></dl>
      </section>
      <section aria-label="Classification exceptions" className="space-y-2 rounded-lg border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Classification exceptions</h3><Status ok={model.classificationComplete}>{model.classificationComplete ? "No unresolved classifications" : "Review the recorded evidence"}</Status></div>
        <p className="text-xs leading-relaxed text-muted-foreground">These entries are excluded from P&amp;L. Cash exceptions also appear in the cash reconciliation; they are the same entries, not additional movements. A net zero can still contain unresolved entries.</p>
        {model.unresolved.length > 0 && <Rows rows={model.unresolved.map((r) => ({ ...r, label: `${r.label} (${r.ids.length} ${r.ids.length === 1 ? "entry" : "entries"})` }))} onOpen={open} explanations />}
        {cash.adjustments.filter((r) => r.key === "internal").map((r) => <Rows key={r.key} rows={[r]} onOpen={open} explanations />)}
        {pnl.basisIssue && <p className="text-xs text-amber-800 dark:text-amber-400">Asset evidence needs review: {pnl.basisIssue}.</p>}
        {cash.differenceMinor !== 0 && <p className="text-xs text-amber-800 dark:text-amber-400">The statement evidence and loaded balances differ by {signedMoney(cash.differenceMinor)}. Refresh Financial Insights to re-read both; no balancing transaction is invented.</p>}
      </section>
    {model.investmentActivity.ids.length > 0 && <div className="[&>section]:h-auto"><TableCard id="statement-investment-activity" title="Investment activity" hint="Recorded within off-budget investments and retirement" info={model.investmentActivity.detail} head={["Activity", "Amount", "Entries"]} rows={[[model.investmentActivity.label, model.investmentActivity.amountMinor, String(model.investmentActivity.ids.length)]]} csvScope={scope}
      note="These recorded movements change investment balances. They are separate from income, expenses and available-cash movements; transfers to and from cash appear in investing activities above.">
      <Rows rows={[{ ...model.investmentActivity, label: `${model.investmentActivity.label} (${model.investmentActivity.ids.length} ${model.investmentActivity.ids.length === 1 ? "entry" : "entries"})`, detail: undefined }]} onOpen={open} />
    </TableCard></div>}</div>
      <div className="[&>section]:h-auto"><TableCard actions={accountGroupKeys.length > 0 && <><Button variant="ghost" size="xs" onClick={() => { setClosedBalanceSections(new Set()); setExpandedAccounts(new Set(accountGroupKeys)); }}>Expand all</Button><Button variant="ghost" size="xs" onClick={() => setExpandedAccounts(new Set())}>Collapse all</Button></>} id="balance-sheet" title="Balance Sheet" hint={`As of ${formatDay(period.endDate)}`} info="Included account balances at the end of the selected period. Net worth is assets less liabilities; it is a calculated residual, not retained earnings." head={["Section", "Account group", "Account", "Financial Reporting", "Balance"]} rows={[
        ...balanceGroups.flatMap((group) => group.rows.map((row) => [group.label, row.groupName, `${row.name}${row.closed ? " (closed)" : ""}`, row.reporting, row.amountMinor])),
        ["Totals", "", "Total assets", "", balanceSheet.assetsMinor], ["Totals", "", "Total liabilities", "", balanceSheet.liabilitiesMinor], ["Totals", "", "Net worth", "", balanceSheet.netWorthMinor],
      ]} csvScope={[["As of", formatDay(period.endDate)], ...scope]} footer={<div className={`flex justify-between gap-3 border-t border-border bg-muted/60 px-3 py-3 ${STATEMENT_TOTAL}`}><span>Net worth</span><span className="tabular-nums">{money(balanceSheet.netWorthMinor)}</span></div>} note="Net worth is calculated as assets less liabilities, so the equation is an identity, not an independent reconciliation. Accounts are grouped by class, with the same classes, names and order as What you own and owe on Summary, so each class total matches it. Current classifications apply to historical periods; accounts left out of Financial Insights are omitted.">
        <div className="space-y-4 pt-2">
          <Headline figures={[["Assets", balanceSheet.assetsMinor], ["Liabilities", balanceSheet.liabilitiesMinor], ["Net worth", balanceSheet.netWorthMinor]]} />
          <div><h3 className="mb-2 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">Assets</h3><BalanceSheetGroups expanded={expandedAccounts} setExpanded={setExpandedAccounts} closed={closedBalanceSections} setClosed={setClosedBalanceSections} groups={balanceSheet.assets} empty="No included asset accounts." /><div className="mt-2 flex justify-between gap-3 border-t border-border px-3 py-2 text-xs font-semibold"><span>Total assets</span><span className="tabular-nums">{money(balanceSheet.assetsMinor)}</span></div></div>
          <div><h3 className="mb-2 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Liabilities</h3><BalanceSheetGroups expanded={expandedAccounts} setExpanded={setExpandedAccounts} closed={closedBalanceSections} setClosed={setClosedBalanceSections} groups={balanceSheet.liabilities} empty="No included liability accounts." /><div className="mt-2 flex justify-between gap-3 border-t border-border px-3 py-2 text-xs font-semibold"><span>Total liabilities</span><span className="tabular-nums">{money(balanceSheet.liabilitiesMinor)}</span></div></div>
        </div>
      </TableCard></div>
    </div>

  </div>;
}
