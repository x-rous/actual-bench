"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Download, CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { OverlayScrollArea } from "@/features/budget-management/components/OverlayScrollArea";
import { downloadCsv } from "@/lib/csv";
import { accountClassLabel, type AccountClass } from "@/lib/account-class";
import type { DrillTarget } from "@/lib/financial-insights/drill";
import { addMonths } from "@/lib/financial-insights/period";
import { statementsCsvRows, type StatementGroup, type StatementLine, type Statements } from "@/lib/financial-insights/statements";
import { treatmentLabel } from "@/lib/financial-insights/wealth";
import type { ReadyData } from "../hooks/useFinancialInsights";
import { useStatements } from "../hooks/useStatements";
import { formatDay, money, signedMoney } from "../format";
import { DrillLink } from "./DrillLink";
import { LoadingState } from "./LoadingState";
import { TableCard } from "./TableCard";
import { InfoTip } from "./InfoTip";

type Props = { data: ReadyData; onDrill: (target: DrillTarget) => void };
type OpenLine = (row: StatementLine) => void;
const RULES: Record<AccountClass, string> = {
  cash: "Cash balance; categorized receipts/payments and uncategorized on-budget receipts/payments are operating.",
  bank: "Cash balance unless fixed / restricted; fixed-deposit transfers are investing.",
  vehicle: "Cash purchases / capital and transfers received are investing. Value changes stay out of P&L.",
  property: "Cash purchases / capital and transfers received are investing. Categorized rents and costs enter P&L.",
  investment: "Cash funding and withdrawals are investing. Uncategorized internal activity stays outside P&L.",
  retirement: "Cash funding and withdrawals are investing. Uncategorized internal activity stays outside P&L.",
  "other-asset": "Fixed-asset cash transfers are investing. Other transfers need an identified purpose.",
  "credit-card": "Purchases enter P&L once, including uncategorized on-budget payments. Ordinary settlements are operating; cash receipts need a purpose.",
  loan: "Borrowing is financing. Recorded split principal is financing; unsplit payment composition needs review.",
  "other-liability": "Current / non-current does not identify borrowing versus payables; transfers need review.",
  excluded: "Activity excluded. Its cash counterpart is a scope exception.",
};

function Figure({ row, onOpen }: { row: StatementLine; onOpen: OpenLine }) {
  return row.ids.length ? <DrillLink label={`${row.label} ${signedMoney(row.amountMinor)}`} onClick={() => onOpen(row)}>{signedMoney(row.amountMinor)}</DrillLink> : <span className="tabular-nums">{signedMoney(row.amountMinor)}</span>;
}

function Rows({ rows, onOpen, explanations = false }: { rows: StatementLine[]; onOpen: OpenLine; explanations?: boolean }) {
  return <table className="w-full text-xs"><thead className="sr-only"><tr><th scope="col">Line</th><th scope="col">Amount</th></tr></thead><tbody>
    {rows.map((row) => <tr key={row.key} className="border-b border-border/50">
      <th scope="row" className="py-1 pl-5 pr-3 text-left font-normal"><span className="inline-flex items-center gap-1">{row.label}{row.detail && !explanations && <InfoTip label={row.label}>{row.detail}</InfoTip>}</span>{row.detail && explanations && <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{row.detail}</span>}</th>
      <td className="py-1 pr-3 text-right align-top whitespace-nowrap"><Figure row={row} onOpen={onOpen} /></td>
    </tr>)}
  </tbody></table>;
}

function Total({ label, amountMinor, rows, onOpen, strong = false }: { label: string; amountMinor: number; rows?: StatementLine[]; onOpen: OpenLine; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 px-3 text-xs font-semibold ${strong ? "rounded-md border border-border bg-muted/60 py-2.5 text-sm" : "border-t border-border bg-muted/30 py-2"}`}>
    <span>{label}</span><Figure row={{ key: label, label, amountMinor, ids: rows?.flatMap((r) => r.ids) ?? [] }} onOpen={onOpen} />
  </div>;
}

function Categories({ groups, onOpen }: { groups: StatementGroup[]; onOpen: OpenLine }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  if (!groups.length) return <p className="py-2 pl-5 text-xs text-muted-foreground">No income or expense entries in this period.</p>;
  return <table className="w-full table-fixed text-xs">
    <colgroup><col /><col className="w-36" /></colgroup>
    <thead className="border-b border-border/60 text-[11px] text-muted-foreground"><tr><th scope="col" className="py-1 pl-5 text-left font-normal">Group / category</th><th scope="col" className="py-1 pr-3 text-right font-normal">Amount</th></tr></thead>
    <tbody>{groups.map((group) => {
      const isOpen = expanded.has(group.key);
      return <Fragment key={group.key}>
        <tr className="border-b border-border/40">
          <th scope="row" className="py-0.5 pl-4 pr-2 text-left font-normal">
            <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${group.label}, ${group.rows.length} ${group.rows.length === 1 ? "category" : "categories"}`} title={group.label}
              className="-ml-1 flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setExpanded((current) => { const next = new Set(current); if (!next.delete(group.key)) next.add(group.key); return next; })}>
              <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden /><span className="truncate font-medium">{group.label}</span>
            </button>
          </th>
          <td className="py-1 pr-3 text-right whitespace-nowrap"><Figure row={group} onOpen={onOpen} /></td>
        </tr>
        {isOpen && group.rows.map((row) => <tr key={row.key} className="border-b border-border/30">
          <th scope="row" className="truncate py-1 pl-10 pr-2 text-left font-normal text-muted-foreground" title={row.label}>{row.label}</th>
          <td className="py-1 pr-3 text-right whitespace-nowrap"><Figure row={row} onOpen={onOpen} /></td>
        </tr>)}
      </Fragment>;
    })}</tbody>
  </table>;
}

/** The header, indented lines and subtotal belong to one visible statement section. */
function StatementSection({ title, children, total, warning = false }: { title: string; children: ReactNode; total?: ReactNode; warning?: boolean }) {
  return <section aria-label={title} className={`overflow-hidden rounded-md border ${warning ? "border-amber-500/30" : "border-border"}`}>
    <h3 className={`border-b px-3 py-2 text-xs font-semibold ${warning ? "border-amber-500/20 bg-amber-500/10" : "border-border bg-muted/60"}`}>{title}</h3>
    <div className="py-1">{children}</div>
    {total}
  </section>;
}

function ClassificationRules({ data }: { data: ReadyData }) {
  const { ledger } = data;
  return <Dialog>
    <DialogTrigger render={<Button variant="outline" size="xs" />}>Account classification rules</DialogTrigger>
    <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
      <DialogHeader className="shrink-0 pr-6"><DialogTitle>Account classification rules</DialogTitle><DialogDescription className="text-xs">The eleven existing classes and saved Financial Reporting choices apply to the entire history. Current versus non-current describes maturity; it does not establish a transfer&apos;s purpose.</DialogDescription></DialogHeader>
      <OverlayScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 pr-2"><table className="w-full text-xs"><thead><tr className="border-b border-border"><th scope="col" className="py-1.5 text-left">Class</th><th scope="col" className="py-1.5 text-left">Statement treatment</th></tr></thead><tbody>{Object.entries(RULES).map(([key, rule]) => <tr key={key} className="border-b border-border/40"><th scope="row" className="py-1.5 pr-4 text-left font-medium whitespace-nowrap">{accountClassLabel(key as AccountClass)}</th><td className="py-1.5 text-muted-foreground">{rule}</td></tr>)}</tbody></table>
          <details><summary className="cursor-pointer text-xs font-medium">Included accounts and saved treatments ({ledger.facts.accounts.length})</summary><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{ledger.facts.accounts.map((a) => <li key={a.id}>{a.name} · {accountClassLabel(a.accountClass)} · {treatmentLabel(a)}{a.closed ? " · Closed; history included" : ""}</li>)}</ul></details>
        </div>
      </OverlayScrollArea>
    </DialogContent>
  </Dialog>;
}

function Headline({ figures }: { figures: [string, number | null][] }) {
  return <dl className="mb-4 grid grid-cols-3 divide-x divide-border rounded-md border border-border bg-muted/25">
    {figures.map(([label, amount]) => <div key={label} className="min-w-0 px-3 py-3"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{amount === null ? "Needs review" : money(amount)}</dd></div>)}
  </dl>;
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
  const { period, ledger } = data;
  const { cash, pnl } = model;
  const open: OpenLine = (row) => onDrill({ kind: "statement", name: row.label, ids: row.ids, amountMinor: row.amountMinor, description: row.detail });
  const scope: [string, string][] = [["Period", `${period.label}: ${formatDay(period.startDate)} to ${formatDay(period.endDate)}`], ["Basis", "Recorded categories; uncategorized on-budget receipts/payments by sign; investment activity separate"], ["Classification", model.classificationComplete ? "Complete" : "Needs review"], ["P&L status", pnl.basisIssue ?? "Recorded result"]];
  const csv = statementsCsvRows(model, period);
  const csvRows = (statement: string) => csv.filter((r) => r[0] === statement).map((r) => r.slice(1));
  const before = addMonths(period.startMonth, -1);
  const cashAccounts = ledger.facts.accounts.filter((a) => ledger.role.get(a.id) === "cash");
  return <div className="space-y-4 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-base font-semibold">Financial statements</h2><p className="mt-0.5 text-xs text-muted-foreground">Cash movements beside income and expenses, for the same reporting period.</p></div>
      <div className="flex gap-2"><ClassificationRules data={data} /><Button variant="outline" size="xs" onClick={() => downloadCsv("financial-insights-statements.csv", csv)}><Download className="size-3.5" aria-hidden />Export CSV</Button></div>
    </div>
    <div className="grid grid-cols-2 items-stretch gap-4" data-testid="statements-pair">
      <TableCard id="cash-flow-statement" title="Cash Flow Statement" hint="Cash movements" info="Cash and Bank cash-equivalent accounts, on or off budget. Fixed / restricted deposits are outside cash. Ordinary card settlements are operating; unidentified purposes are separate." head={["Section", "Line", "Amount", "Entries", "Explanation"]} rows={csvRows("Cash flow")} csvScope={scope}
        note={<div className="space-y-1"><Status ok={cash.differenceMinor === 0}>{cash.differenceMinor === 0 ? "Balances reconcile" : "Balances do not reconcile"}</Status><p>{money(cash.openingMinor)} + ({signedMoney(cash.changeMinor)}) = {money(cash.closingMinor)}</p><p>Unclassified movements and starting balances are included in this identity, separately from the three activity subtotals.</p></div>}>
        <div className="space-y-3 pt-2">
          <Headline figures={[["Opening cash", cash.openingMinor], ["Net cash movement", cash.changeMinor], ["Closing cash", cash.closingMinor]]} />
          {cash.sections.map((section) => <StatementSection key={section.key} title={section.label} total={<Total label={`Net cash from ${section.label.toLowerCase()}`} amountMinor={section.amountMinor} rows={section.rows} onOpen={open} />}>{section.rows.length ? <Rows rows={section.rows} onOpen={open} /> : <p className="py-2 pl-5 pr-3 text-xs text-muted-foreground">No identified activity in this period.</p>}</StatementSection>)}
          {cash.adjustments.length > 0 && <StatementSection title="Unclassified movements and adjustments" warning total={<Total label="Net unclassified movements and adjustments" amountMinor={cash.adjustments.reduce((sum, row) => sum + row.amountMinor, 0)} rows={cash.adjustments} onOpen={open} />}><Rows rows={cash.adjustments} onOpen={open} /></StatementSection>}
          {cash.differenceMinor !== 0 && <Total label="Unexplained difference" amountMinor={cash.differenceMinor} onOpen={open} />}
          <Total strong label={cash.changeMinor < 0 ? "Net decrease in cash" : "Net increase in cash"} amountMinor={cash.changeMinor} onOpen={open} />
        </div>
      </TableCard>
      <TableCard id="income-statement" title="Income Statement (P&L)" hint="Recorded income and expenses" info="Uses Actual categories, including hidden categories and recorded card purchases. Uncategorized on-budget entries count by sign in their own income or expense group, as in the Income and Spending tabs. Off-budget Investment / Retirement activity stays separate. Transfers, principal, starting balances and registry-classified asset capital, value changes and sales are excluded." head={["Section", "Line", "Amount", "Entries", "Explanation"]} rows={csvRows("P&L")} csvScope={scope}
        note={<div className="space-y-1"><p className="font-medium">Transaction-based reporting</p><p>Categories determine income and expenses; uncategorized on-budget entries count by sign, including card purchases. Off-budget investment activity stays outside P&amp;L. This is not an accrual forecast.</p>{pnl.basisIssue && <p className="text-amber-800 dark:text-amber-400">Needs review: {pnl.basisIssue}. Category totals are provisional.</p>}</div>}>
        <div className="space-y-3 pt-2">
          <Headline figures={[["Income", pnl.incomeMinor], ["Expenses", -pnl.expensesMinor], [pnl.surplusMinor < 0 ? "Net deficit" : "Net surplus", pnl.basisIssue ? null : pnl.surplusMinor]]} />
          <StatementSection title="Income" total={<Total label="Total income" amountMinor={pnl.incomeMinor} rows={pnl.income} onOpen={open} />}><Categories groups={pnl.income} onOpen={open} /></StatementSection>
          <StatementSection title="Expenses" total={<Total label="Total expenses" amountMinor={pnl.expensesMinor} rows={pnl.expenses} onOpen={open} />}><Categories groups={pnl.expenses} onOpen={open} /></StatementSection>
          {pnl.basisIssue ? <div role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-semibold">Net surplus / deficit needs review</div> : <Total strong label="Net surplus / deficit" amountMinor={pnl.surplusMinor} rows={[...pnl.income, ...pnl.expenses]} onOpen={open} />}
        </div>
      </TableCard>
    </div>
    <div className="grid grid-cols-2 gap-4">
      <section aria-label="Why the bottom lines differ" className="space-y-2 rounded-lg border border-border bg-card p-4"><h3 className="text-sm font-semibold">Why the bottom lines differ</h3><p className="text-xs leading-relaxed text-muted-foreground">Card purchases enter expenses when recorded; settlements change cash later. Income and expenses in other noncash accounts, investing, financing, and unresolved cash activity explain the rest. Signs below are adjustments to surplus.</p>
        {pnl.basisIssue && <p className="text-xs text-amber-800 dark:text-amber-400">This bridge uses the provisional result while P&amp;L needs review.</p>}
        <dl className="divide-y divide-border/50 text-xs">{model.bridge.filter((r, i) => i === 0 || r.amountMinor !== 0).map((row) => <div key={row.label} className="flex justify-between gap-3 py-2"><dt>{row.label}</dt><dd className="tabular-nums whitespace-nowrap">{signedMoney(row.amountMinor)}</dd></div>)}<div className="flex justify-between gap-3 py-2 font-semibold"><dt>Net cash movement</dt><dd className="tabular-nums">{signedMoney(cash.changeMinor)}</dd></div></dl>
      </section>
      <section aria-label="Classification exceptions" className="space-y-2 rounded-lg border border-border bg-card p-4"><h3 className="text-sm font-semibold">Classification exceptions</h3><Status ok={model.classificationComplete}>{model.classificationComplete ? "No unresolved classifications" : "Review the recorded evidence"}</Status>
        <p className="text-xs leading-relaxed text-muted-foreground">These entries are excluded from P&amp;L. Cash exceptions also appear in the cash reconciliation; they are the same entries, not additional movements. A net zero can still contain unresolved entries.</p>
        {model.unresolved.length > 0 && <Rows rows={model.unresolved.map((r) => ({ ...r, label: `${r.label} (${r.ids.length} ${r.ids.length === 1 ? "entry" : "entries"})` }))} onOpen={open} explanations />}
        {cash.adjustments.filter((r) => r.key === "internal").map((r) => <Rows key={r.key} rows={[r]} onOpen={open} explanations />)}
        {pnl.basisIssue && <p className="text-xs text-amber-800 dark:text-amber-400">Asset evidence needs review: {pnl.basisIssue}.</p>}
        {cash.differenceMinor !== 0 && <p className="text-xs text-amber-800 dark:text-amber-400">The statement evidence and loaded balances differ by {signedMoney(cash.differenceMinor)}. Refresh Financial Insights to re-read both; no balancing transaction is invented.</p>}
      </section>
    </div>
    {model.investmentActivity.ids.length > 0 && <TableCard id="statement-investment-activity" title="Investment activity" hint="Recorded within off-budget investments and retirement" info={model.investmentActivity.detail} head={["Activity", "Amount", "Entries"]} rows={[[model.investmentActivity.label, model.investmentActivity.amountMinor, String(model.investmentActivity.ids.length)]]} csvScope={scope}
      note="These recorded movements change investment balances. They are separate from income, expenses and available-cash movements; transfers to and from cash appear in investing activities above.">
      <Rows rows={[{ ...model.investmentActivity, label: `${model.investmentActivity.label} (${model.investmentActivity.ids.length} ${model.investmentActivity.ids.length === 1 ? "entry" : "entries"})`, detail: undefined }]} onOpen={open} />
    </TableCard>}
    <TableCard id="statement-cash-accounts" title="Which accounts form cash?" info="Balances before the first day of the period and at its end, from the shared ledger. Closed accounts retain their history. Fixed / restricted deposits are excluded." head={["Account", "Opening cash", "Closing cash"]} rows={cashAccounts.map((a) => [a.name, ledger.balanceAt(a.id, before), ledger.balanceAt(a.id, period.endMonth)])} csvScope={scope} collapsible>
      <table className="w-full text-xs"><thead><tr className="border-b border-border"><th scope="col" className="py-2 text-left">Account</th><th scope="col" className="py-2 text-right">Opening cash</th><th scope="col" className="py-2 text-right">Closing cash</th></tr></thead><tbody>{cashAccounts.map((a) => <tr key={a.id} className="border-b border-border/50"><th scope="row" className="py-2 text-left font-normal">{a.name}{a.closed ? " (closed)" : ""}</th><td className="py-2 text-right tabular-nums">{money(ledger.balanceAt(a.id, before))}</td><td className="py-2 text-right tabular-nums">{money(ledger.balanceAt(a.id, period.endMonth))}</td></tr>)}</tbody><tfoot><tr className="font-semibold"><th scope="row" className="py-2 text-left">Total cash equivalents</th><td className="text-right tabular-nums">{money(cash.openingMinor)}</td><td className="text-right tabular-nums">{money(cash.closingMinor)}</td></tr></tfoot></table>
    </TableCard>
  </div>;
}
