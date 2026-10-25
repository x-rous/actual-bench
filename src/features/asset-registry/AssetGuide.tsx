"use client";
import type { ReactNode } from "react";
import { ArrowLeftRight, ArrowRight, Banknote, Building2, Landmark, Lightbulb, PiggyBank, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Example, Heading, Para, Steps, Tag } from "@/features/credit-cards/components/guide/CreditCardGuide";
import { StatusBadge } from "@/features/credit-cards/components/primitives/StatusBadge";
import { BOOK_TYPE_TAGS } from "@/lib/asset-registry/tags";

/** The Assets guide: one dialog with the picture first and the words second, using one example throughout. */
export type AssetGuideSection = "start" | "concepts" | "account" | "income" | "overview" | "depreciation" | "loans" | "tags" | "glossary";
export const ASSET_GUIDE_SECTIONS: [AssetGuideSection, string][] = [
  ["start", "Getting started"], ["concepts", "Two kinds of transactions"], ["account", "Account Transactions"], ["income", "Income & Expenses"],
  ["overview", "Reading the Overview"], ["loans", "Linked Loans"], ["depreciation", "Depreciation Schedule"], ["tags", "Tags in Actual"], ["glossary", "Glossary"],
];
/** The guide section that explains the workspace tab you are on. */
export const guideSectionForTab = (tab: string | null): AssetGuideSection => (
  tab === "Account Transactions" ? "account" : tab === "Income & Expenses" ? "income" : tab === "Depreciation Schedule" ? "depreciation" : tab === "Linked Loans" ? "loans" : tab === "Overview" ? "overview" : "start");

type Tone = "value" | "income" | "expense" | "capital" | "loan";
const TONES: Record<Tone, string> = {
  value: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  income: "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300",
  expense: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
  capital: "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  loan: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};
const Chip = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONES[tone])}>{children}</span>;
function Callout({ tone = "tip", title, children }: { tone?: "tip" | "warn"; title: string; children: ReactNode }) {
  const Icon = tone === "tip" ? Lightbulb : TriangleAlert;
  return <aside className={cn("my-3 flex max-w-3xl gap-3 rounded-lg border px-3 py-2.5 text-xs", tone === "tip" ? "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20" : "border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20")}>
    <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "tip" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400")} aria-hidden /><div><p className="font-semibold">{title}</p><div className="mt-0.5 leading-relaxed text-foreground/80">{children}</div></div>
  </aside>;
}
const Money = ({ children, tone }: { children: ReactNode; tone?: "plus" | "minus" }) => <span className={cn("tabular-nums", tone === "plus" && "text-green-700 dark:text-green-400", tone === "minus" && "text-red-700 dark:text-red-400")}>{children}</span>;
function Lane({ icon: Icon, title, caption, tone, rows, total }: { icon: typeof Landmark; title: string; caption: string; tone: Tone; rows: [string, string, Tone][]; total: [string, string] }) {
  return <div className={cn("flex-1 rounded-lg border p-3", TONES[tone])}>
    <div className="flex items-center gap-2"><Icon className="size-4" aria-hidden /><div><p className="text-xs font-semibold">{title}</p><p className="text-[11px] opacity-80">{caption}</p></div></div>
    <ul className="mt-2 divide-y divide-current/10 rounded-md border border-current/10 bg-background text-xs text-foreground">{rows.map(([label, amount, t]) => <li key={label} className="flex items-center justify-between gap-3 px-2.5 py-1.5"><span>{label}</span><span className="flex items-center gap-2"><Chip tone={t}>{t === "value" ? "value" : t === "capital" ? "capital" : t === "income" ? "income" : "expense"}</Chip><Money tone={amount.startsWith("-") ? "minus" : "plus"}>{amount}</Money></span></li>)}</ul>
    <p className="mt-2 flex justify-between text-xs font-semibold"><span>{total[0]}</span><span className="tabular-nums">{total[1]}</span></p>
  </div>;
}
/** A static sketch of the value timeline, to show how the markers read. */
function MiniTimeline() {
  return <figure className="my-3 max-w-xl rounded-lg border bg-background p-3" aria-label="Sketch of the value timeline">
    <svg viewBox="0 0 400 130" className="w-full" role="img" aria-label="A stepped value line with a purchase, an improvement, a revaluation and a loan allocation change">
      <g stroke="currentColor" strokeOpacity="0.12"><line x1="30" x2="390" y1="20" y2="20" /><line x1="30" x2="390" y1="55" y2="55" /><line x1="30" x2="390" y1="90" y2="90" /></g>
      <path d="M30 70 H110 V30 H210 V26 H290 V18 H390" fill="none" stroke="#2563eb" strokeWidth="2.5" />
      <path d="M30 100 H210 V100 H290 V82 H390" fill="none" stroke="#e11d48" strokeWidth="2" />
      <path d="M390 18 L400 22" stroke="#2563eb" strokeDasharray="3 3" />
      {[[110, "#16a34a"], [210, "#16a34a"], [290, "#f59e0b"]].map(([x, c]) => <path key={String(x)} d={`M${x} 108 l5 6 -5 6 -5 -6z`} fill={String(c)} />)}
      {[160, 185, 235, 260, 315, 340, 365].map((x) => <rect key={x} x={x - 1} y="108" width="2" height="12" rx="1" fill="#64748b" />)}
      <circle cx="290" cy="114" r="4" fill="#6366f1" />
      <text x="32" y="64" fontSize="9" fill="currentColor" opacity="0.7">Purchase</text><text x="112" y="24" fontSize="9" fill="currentColor" opacity="0.7">Kitchen</text><text x="214" y="14" fontSize="9" fill="currentColor" opacity="0.7">Revaluation</text>
    </svg>
    <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span><b className="text-blue-600">━</b> Recorded value</span><span><b className="text-rose-600">━</b> Allocated debt</span><span><b className="text-green-600">◆</b> Purchase or improvement</span><span><b className="text-amber-500">◆</b> Revaluation</span><span><b className="text-slate-500">|</b> Depreciation</span><span><b className="text-indigo-500">●</b> Loan allocation change</span></figcaption>
  </figure>;
}
const Tile = ({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: Tone }) => <div className={cn("rounded-lg border px-3 py-2", tone ? TONES[tone] : "bg-background")}><p className="text-[11px] opacity-80">{label}</p><p className="text-base font-semibold tabular-nums">{value}</p><p className="text-[11px] opacity-80">{detail}</p></div>;
const Card = ({ icon: Icon, title, children, tone }: { icon: typeof Landmark; title: string; children: ReactNode; tone: Tone }) => <div className={cn("rounded-lg border p-3", TONES[tone])}><div className="flex items-center gap-2 text-xs font-semibold"><Icon className="size-4" aria-hidden />{title}</div><div className="mt-1.5 text-xs leading-relaxed text-foreground/80">{children}</div></div>;

export function AssetGuide({ section, onSection, onClose, docsUrl }: { section: AssetGuideSection; onSection: (section: AssetGuideSection) => void; onClose: () => void; docsUrl?: string }) {
  const link = (to: AssetGuideSection, text: string) => <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSection(to)}>{text}</button>;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-5xl">
      <DialogHeader className="shrink-0 border-b px-5 py-4">
        <DialogTitle className="text-sm">Assets guide</DialogTitle>
        <DialogDescription className="text-xs">What you own, what it is worth, what it earns and what you owe on it, all read from Actual.{docsUrl && <> <a className="font-medium text-primary hover:underline" href={docsUrl} target="_blank" rel="noopener noreferrer">Full documentation</a></>}</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav aria-label="Guide sections" className="flex w-52 shrink-0 flex-col gap-0.5 border-r p-2 pt-3">
          {ASSET_GUIDE_SECTIONS.map(([id, label]) => <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => onSection(id)}
            className={cn("rounded px-2 py-1.5 text-left text-xs transition-colors", section === id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground")}>{label}</button>)}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5" aria-live="polite">
          <h2 className="mb-4 text-base font-semibold">{ASSET_GUIDE_SECTIONS.find(([id]) => id === section)![1]}</h2>
          {section === "start" && <>
            <Para>An asset is something you own that isn&apos;t a regular bank account: a home, a car, an investment. Bench tracks it from your Actual data, so every figure can be traced back to a transaction. Nothing is invented.</Para>
            <div className="grid max-w-4xl gap-3 sm:grid-cols-3">
              <Card tone="value" icon={Landmark} title="What it is worth">Its own account in Actual holds the transactions that set its value: the purchase, improvements, revaluations, depreciation. See {link("account", "Account Transactions")}.</Card>
              <Card tone="income" icon={Banknote} title="What it earns and costs">Rent, repairs and bills come from your everyday accounts and are linked to the asset. See {link("income", "Income & Expenses")}.</Card>
              <Card tone="loan" icon={Building2} title="What you owe on it">Link a loan to see debt and equity beside the value. See {link("loans", "Linked Loans")}.</Card>
            </div>
            <Heading>Your first asset</Heading>
            <Steps items={[
              ["The asset", "Name, type and the off-budget account in Actual that holds its value, existing or new. Say whether it earns income. Ownership is 100% unless you change it."],
              ["How you got it", "A purchase you paid, an expense you already entered, or a starting value. Optional: you can skip it and do it later."],
              ["Review and create", "See exactly what will happen, and what writes to Actual, before anything does."],
            ]} />
            <Callout title="Nothing is automatic">If you skip how you got it, an amber <b>Record how you got it</b> button stays in the Needs attention strip on the asset&apos;s Overview until it has a first value. Bench never posts anything on its own: every write to Actual is a confirmed action.</Callout>
          </>}
          {section === "concepts" && <>
            <Para>This is the idea everything else rests on. An asset has <b>two kinds of transactions</b>, and they live in different places. Mixing them up is the most common source of confusion.</Para>
            <div className="flex max-w-4xl flex-col items-stretch gap-3 lg:flex-row">
              <Lane tone="value" icon={Landmark} title="The asset's own account" caption="Off-budget · transactions here set the asset's value" rows={[["Purchase", "+2,000,000.00", "value"], ["New kitchen", "+20,000.00", "capital"], ["Revaluation", "+100,000.00", "value"], ["Depreciation", "-2,000.00", "value"]]} total={["Recorded value", "2,118,000.00"]} />
              <div className="flex items-center justify-center text-muted-foreground lg:flex-col"><ArrowLeftRight className="size-5" aria-hidden /><span className="max-w-24 text-center text-[11px]">Capital spending is added to the value</span></div>
              <Lane tone="income" icon={PiggyBank} title="Your everyday accounts" caption="On budget · linked to the asset, never change its value" rows={[["Rent from tenant", "+1,500.00", "income"], ["Boiler service", "-350.00", "expense"], ["Plumbing repair", "-200.00", "expense"]]} total={["Operating result", "+950.00"]} />
            </div>
            <Example caption="The same question, answered two ways" head={["", "Account Transactions", "Income & Expenses"]} rows={[
              ["Where they live", "The asset's own off-budget account", "Your everyday on-budget accounts"], ["What they do", "Set the asset's recorded value", "Show what it earned or cost to run"],
              ["Examples", "Purchase, improvements, revaluation, depreciation, sale", "Rent, repairs, insurance, interest, taxes"], ["Matches Actual", "Yes, row for row, in the asset's account", "Yes: they are your own transactions, only linked"],
            ]} />
            <Callout title="A rule of thumb">If it changes what the asset is <b>worth</b>, it belongs in the asset&apos;s own account. If it is money earned or spent <b>running</b> it, it stays in your everyday account and you link it.</Callout>
            <Callout title="What about the purchase?">Most people entered the purchase as an expense. That is fine: <b>Add expense to asset value</b> adds its value to the asset without touching your expense or its category.</Callout>
          </>}
          {section === "account" && <>
            <Para>This tab is the asset&apos;s own account in Actual, shown as a list. It matches that account exactly: add, edit or delete a transaction here or in Actual and the other follows. Each transaction gets a <b>type</b> that explains it.</Para>
            <Heading>Types, by what they do to the value</Heading>
            <div className="flex max-w-3xl flex-wrap gap-2">{[["Opening Balance", "value"], ["Acquisition / Purchase", "capital"], ["Capital expenditure (purchase or improvement)", "capital"], ["Revaluation / Appreciation", "value"], ["Depreciation", "expense"], ["Impairment / Write-down", "expense"], ["Disposal", "loan"], ["Ownership Adjustment", "value"], ["Other Adjustment", "value"]].map(([label, tone]) => <Chip key={label} tone={tone as Tone}>{label}</Chip>)}</div>
            <Example caption="Which one when" head={["Type", "Use it for", "Sign"]} rows={[
              ["Opening Balance", "The value the asset started with", "+"], ["Acquisition / Purchase", "A purchase paid by a transfer into the account", "+"], ["Capital expenditure", "A purchase or improvement you paid as an expense and added to the value", "+"],
              ["Revaluation", "A new market value, up or down", "+ or −"], ["Depreciation / Impairment", "Wear and write-downs", "−"], ["Disposal", "The value leaving when you sell or write off", "−"],
            ]} />
            <Heading>Doing things</Heading>
            <Steps items={[["Update value", "Enter what it is worth now. Bench adds the one revaluation that gets there."], ["Add transaction", "Create a real transaction in the asset's account, with a type."], ["Edit or delete", "Use the pencil or trash on a row. Transfers, split, reconciled and scheduled rows can only be re-typed."]]} />
            <Callout title="The type is written into Actual">Typing a transaction also puts a tag such as <Tag>{BOOK_TYPE_TAGS.revaluation}</Tag> in its Notes, so the type is readable in Actual too. See {link("tags", "Tags in Actual")}.</Callout>
          </>}
          {section === "income" && <>
            <Para>These are transactions from your <b>other</b> accounts that belong to the asset. Linking only adds a label inside Bench: the transaction&apos;s category, payee, amount, Notes and date never change, and it never changes the asset&apos;s value.</Para>
            <Heading>Three ways to link</Heading>
            <div className="grid max-w-4xl gap-3 sm:grid-cols-3">
              <Card tone="income" icon={ArrowRight} title="Pick">Open <b>Link existing transactions</b>, filter by date, account, category, payee or text, tick what belongs and choose how to link it.</Card>
              <Card tone="value" icon={ArrowRight} title="Rule">Save conditions such as <i>payee is Tenant and notes have tag #unit-4</i>. <b>Apply</b> shows every match, already ticked, for you to review.</Card>
              <Card tone="capital" icon={ArrowRight} title="Add to value">Turn an expense into part of the asset&apos;s value with <b>Add expense to asset value</b>, for example a new roof.</Card>
            </div>
            <Heading>How they are grouped</Heading>
            <div className="grid max-w-4xl gap-2 sm:grid-cols-2">
              <div className={cn("rounded-lg border p-2.5 text-xs", TONES.income)}><b>Income</b> · counts toward the operating result<div className="mt-1 text-foreground/80">Rental, dividends or distributions, interest or yield, other income</div></div>
              <div className={cn("rounded-lg border p-2.5 text-xs", TONES.expense)}><b>Expenses</b> · count toward the operating result<div className="mt-1 text-foreground/80">Operating and maintenance, taxes and insurance, financing interest</div></div>
              <div className={cn("rounded-lg border p-2.5 text-xs", TONES.capital)}><b>Capital &amp; disposal</b> · changes the asset&apos;s value, not the operating result<div className="mt-1 text-foreground/80">Capital expenditure, disposal proceeds</div></div>
              <div className="rounded-lg border p-2.5 text-xs"><b>Not counted</b><div className="mt-1 text-foreground/80">Linked but ignored (selling costs are handled with the sale)</div></div>
            </div>
            <Heading>Adding an expense to the asset&apos;s value</Heading>
            <div className="flex max-w-3xl flex-wrap items-center gap-3 text-xs"><div className={cn("rounded-lg border px-3 py-2", TONES.expense)}>Your account<div className="font-semibold tabular-nums">Roof repair −20,000.00</div><div className="text-[11px] opacity-80">stays exactly as it is</div></div><ArrowRight className="size-4 text-muted-foreground" aria-hidden /><div className={cn("rounded-lg border px-3 py-2", TONES.value)}>Asset account<div className="font-semibold tabular-nums">+20,000.00 added</div><div className="text-[11px] opacity-80">one new adjustment, matched to the expense</div></div></div>
            <Callout tone="warn" title="Already have both?">If you entered the adjustment yourself, the Overview shows <b>1 capitalization needs review</b>. Open it and choose <b>Match</b>: Bench records that the two belong together without writing to Actual.</Callout>
          </>}
          {section === "overview" && <>
            <Para>The strip at the top is the asset&apos;s whole life. The charts show how it got there. The tables show how it did in a period.</Para>
            <div className="grid max-w-4xl gap-2 sm:grid-cols-3">
              <Tile tone="value" label="Recorded value" value="2,118,000.00" detail="What Actual says it is worth" />
              <Tile tone="capital" label="Capital added" value="+2,020,000.00" detail="Purchase and improvements" />
              <Tile tone="value" label="Valuation adjustments" value="+98,000.00" detail="Revaluation +100,000 · Depreciation −2,000" />
              <Tile tone="income" label="Operating Result" value="12,950.00" detail="Linked income − costs" />
              <Tile label="Simple Total Return" value="N/A" detail="Needs unclassified transactions classified" />
            </div>
            <Heading>The timeline</Heading>
            <MiniTimeline />
            <Para>Hover a period to read its value, debt and equity. Click a marker to see the transactions behind it. A drop in the debt line at a dot is a <b>change in how much of the loan is yours</b>, not a repayment.</Para>
            <Example caption="How the results are worked out" head={["Figure", "How"]} rows={[
              ["Valuation adjustments", "Revaluation + depreciation + write-downs, added up from the typed transactions"], ["Operating Result", "Linked income − linked expenses; capital and disposals are left out"],
              ["Total Result", "Closing − opening − capital added + net proceeds + operating result"], ["Simple Total Return", "Total Result ÷ (opening + capital added). Not annualized. Shown only when it can be worked out"],
            ]} />
            <Callout tone="warn" title="Why is a figure N/A?">Bench shows N/A rather than guess. The tile says what is missing, most often a transaction without a type. Give it one in Account Transactions and the figure appears.</Callout>
          </>}
          {section === "depreciation" && <>
            <Para>For things that lose value steadily, like a car. A schedule is a personal plan, not tax depreciation. Saving it writes nothing to Actual; you post each ended month yourself.</Para>
            <div className="grid max-w-4xl gap-2 sm:grid-cols-4"><Tile label="Basis" value="600,000.00" detail="Where the schedule starts" /><Tile label="Residual" value="100,000.00" detail="The forecast floor" /><Tile label="Life" value="60 months" detail="Straight-line" /><Tile tone="expense" label="Each month" value="−8,333.33" detail="(basis − residual) ÷ life" /></div>
            <Heading>How it works</Heading>
            <Steps items={[["Save the schedule", "Method, basis, residual and start date."], ["Post ended months", "Select the months due and confirm. Each one becomes a negative adjustment dated at its month end."], ["Follow along", <>Posted months carry <Tag>{BOOK_TYPE_TAGS.depreciation}</Tag> and show as Posted. A deleted row shows as missing and can be reposted.</>]]} />
            <Callout title="Revaluations don't change the plan">If you revalue the asset, the schedule keeps its own numbers. Edit the schedule if you want it to change from now on. The Overview&apos;s dashed line shows where the value is heading if the unposted months post.</Callout>
          </>}
          {section === "loans" && <>
            <Para>Link a loan you already track in Loans &amp; Debt, and say what share of it belongs to this asset. Bench then plots the debt beside the value and works out your equity.</Para>
            <div className="grid max-w-4xl gap-2 sm:grid-cols-3"><Tile tone="value" label="Recorded value" value="252,000.00" detail="On 25 Oct" /><Tile tone="loan" label="Allocated debt" value="118,800.00" detail="Your share of the loan" /><Tile tone="income" label="Tracked equity" value="133,200.00" detail="Value − allocated debt" /></div>
            <Heading>Shares can change</Heading>
            <Example caption="One loan, two periods" head={["From", "Your share", "What it means"]} rows={[["1 Jan 2026", "100%", "The whole loan is yours"], ["1 Jul 2026", "60%", "Someone else took on 40%; earlier months keep their share"]]} />
            <Callout title="A share change isn't a repayment">When your share drops, the allocated debt drops too, even though the loan itself is unchanged. The timeline marks the change so the line isn&apos;t misread. Equity is only shown when the loan&apos;s balance on that date is known.</Callout>
          </>}
          {section === "tags" && <>
            <Para>Giving a transaction a type also writes a readable tag to its Notes in Actual, so the type shows up there and survives without Bench. Transfers, split, reconciled and scheduled transactions are never edited, so their type stays in Bench.</Para>
            <Example caption="Type tags" head={["Type", "Tag"]} rows={Object.entries(BOOK_TYPE_TAGS).map(([type, tag]) => [type.replace(/-/g, " "), <Tag key={type}>{tag}</Tag>])} />
            <Para>A shared account also uses a permanent <Tag>#asset_name</Tag> tag to say which asset a transaction belongs to.</Para>
          </>}
          {section === "glossary" && <Example caption="Terms" head={["Term", "Meaning"]} rows={[
            [<Chip key="a" tone="value">Recorded value</Chip>, "The sum of the transactions in the asset's own account."], [<Chip key="b" tone="capital">Capital added</Chip>, "Opening balance, purchases and improvements."],
            [<Chip key="c" tone="loan">Allocated debt</Chip>, "Your share of a loan's Actual balance on a date."], [<Chip key="d" tone="value">Tracked equity</Chip>, "Recorded value minus allocated debt."],
            [<Chip key="e" tone="expense">CapEx</Chip>, "Capital expenditure: spending that adds to the asset's value, like a new roof."], [<Chip key="f" tone="income">Operating Result</Chip>, "Linked income minus linked expenses."],
            [<StatusBadge key="g" label="Unassigned" tone="attention" />, "A transaction in a shared account that no asset claims yet."], [<StatusBadge key="h" label="Projected" tone="muted" />, "A forecast, not yet posted to Actual."],
          ]} />}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
