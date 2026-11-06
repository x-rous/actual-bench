"use client";

import type { ReactNode } from "react";
import {
  ArrowLeftRight, Banknote, BookOpen, Building2, CircleHelp, CreditCard, FileSearch, Gauge, GitCompare, Home, LayoutDashboard, ListChecks,
  Lock, MousePointerClick, PieChart, Scale, ShieldCheck, ShoppingCart, Target, TrendingUp, UserRound, FilePenLine, type LucideIcon,
} from "lucide-react";
import { GuideFrame } from "@/components/ui/guide-frame";
import { ACCOUNT_CLASS_ICONS } from "@/features/accounts/lib/accountClassIcons";
import type { AccountClass } from "@/lib/account-class";
import { Example, Heading, Para, Steps } from "@/components/ui/guide-primitives";
import {
  BudgetLineSketch, BufferSketch, Callout, Card, Chip, DrillSketch, EquitySketch, FlowSketch, HeatSketch, MiniTile, OwnAndOweSketch,
  PipelineSketch, ReadinessSketch, StackedSketch, WaterfallSketch,
} from "./guideVisuals";

/** The Financial Insights guide: one dialog, the picture first and the words second, one example household throughout. */
export type FinancialInsightsGuideSection =
  | "start" | "different" | "ready" | "summary" | "money" | "income" | "spending" | "budget" | "investments" | "property" | "loans" | "statements" | "buffer" | "drill" | "counted" | "glossary";

export const FINANCIAL_INSIGHTS_GUIDE_SECTIONS: [FinancialInsightsGuideSection, string][] = [
  ["start", "Start here"], ["different", "Why not Actual’s reports?"], ["ready", "Before any number"], ["counted", "How things are counted"], ["summary", "Summary"], ["money", "Money in & out"],
  ["income", "Income"], ["spending", "Spending"], ["budget", "My budget"], ["investments", "Investments"], ["property", "Property & assets"],
  ["loans", "Loans & cards"], ["statements", "Statements"], ["buffer", "Cash buffer & scenarios"], ["drill", "The transactions behind a figure"], ["glossary", "Glossary"],
];

const SECTION_ICONS: Record<FinancialInsightsGuideSection, LucideIcon> = {
  start: BookOpen, different: GitCompare, ready: ShieldCheck, summary: LayoutDashboard, money: ArrowLeftRight, income: Banknote, spending: ShoppingCart,
  budget: Target, investments: TrendingUp, property: Home, loans: CreditCard, statements: Scale, buffer: Gauge, drill: FileSearch, counted: Scale, glossary: CircleHelp,
};

/** The guide section that explains the tab you are on. */
export const guideSectionForTab = (tab: string): FinancialInsightsGuideSection => (
  tab === "money" ? "money" : tab === "income" ? "income" : tab === "spending" ? "spending" : tab === "budget" ? "budget" : tab === "wealth" ? "investments"
    : tab === "property" ? "property" : tab === "loans" ? "loans" : tab === "statements" ? "statements" : tab === "summary" ? "summary" : "start");

const Grid = ({ cols = 3, children }: { cols?: 2 | 3 | 4 | 5; children: ReactNode }) => (
  <div className={`grid max-w-[64.5rem] gap-3 ${cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-3" : cols === 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-5"}`}>{children}</div>
);
const Tiles = ({ children }: { children: ReactNode }) => <div className="grid max-w-[64.5rem] gap-2 sm:grid-cols-2 xl:grid-cols-5">{children}</div>;
const Tag = ({ children }: { children: ReactNode }) => <code className="rounded bg-muted/70 px-1 font-mono text-[11px]">{children}</code>;

type FlowNode = { label: string; accountClass?: AccountClass };
const account = (label: string, accountClass: AccountClass): FlowNode => ({ label, accountClass });
const other = (label: string): FlowNode => ({ label });
type FlowExample = { label: string; left: FlowNode; right: FlowNode; direction: "right" | "left" | "entry" | "link"; impact?: "received" | "spent"; recorded: string; result: string };
const FLOW_GROUPS: { name: string; icon: LucideIcon; placement: string; examples: FlowExample[] }[] = [
  { name: "Cash & bank", icon: ACCOUNT_CLASS_ICONS.bank, placement: "Cash and Bank classes can be on or off budget", examples: [
    { label: "Paycheck", left: account("Checking · on budget", "bank"), right: other("Employer · outside payee"), direction: "left", impact: "received", recorded: "Paycheck with an income category.", result: "Received rises; Change in cash rises." },
    { label: "Groceries", left: account("Checking · on budget", "bank"), right: other("Grocery store · outside payee"), direction: "right", impact: "spent", recorded: "Purchase with a grocery category.", result: "Spent rises; Change in cash falls." },
    { label: "Move to savings", left: account("Checking · on budget", "bank"), right: account("Savings · off budget", "bank"), direction: "right", recorded: "Transfer between two Bank accounts; the category is on the on-budget side.", result: "Cash and Money kept stay the same." },
    { label: "Off-budget payment", left: other("Outside payee"), right: account("Savings · off budget", "bank"), direction: "left", recorded: "Uncategorized entry in the off-budget account.", result: "Unidentified movements; not Spent." },
    { label: "Restricted deposit", left: account("Checking · on budget", "bank"), right: account("Deposit · off budget", "bank"), direction: "right", recorded: "Transfer into a Bank marked Fixed / restricted deposit.", result: "Fixed / restricted deposits rise; cash falls. Still in net worth, not the cash buffer." },
  ] },
  { name: "Investments", icon: ACCOUNT_CLASS_ICONS.investment, placement: "Off budget · Investment needs a current / non-current choice", examples: [
    { label: "Put in", left: account("Checking · on budget", "bank"), right: account("Brokerage · off budget", "investment"), direction: "right", recorded: "Transfer; the on-budget side carries the category.", result: "Funding / Put into investments; not Spent." },
    { label: "Withdraw", left: account("Checking · on budget", "bank"), right: account("Brokerage · off budget", "investment"), direction: "left", recorded: "Withdrawal recorded as a transfer.", result: "Withdrawals / Withdrawn from investments; not Received." },
    { label: "Between investments", left: account("Brokerage A · off budget", "investment"), right: account("Brokerage B · off budget", "investment"), direction: "right", recorded: "Transfer between two portfolio accounts; neither side has a category.", result: "Other per account; cancels in the portfolio total when both sides are in the period." },
    { label: "Investment activity", left: other("Recorded value change"), right: account("Brokerage · off budget", "investment"), direction: "entry", recorded: "Uncategorized non-transfer entry, such as a dividend or price change.", result: "Investment activity: a recorded non-transfer change to the account balance, not a calculated return." },
  ] },
  { name: "Loans", icon: ACCOUNT_CLASS_ICONS.loan, placement: "Off budget · Loan liability", examples: [
    { label: "Borrow", left: account("Checking · on budget", "bank"), right: account("Loan · off budget", "loan"), direction: "left", recorded: "Borrowed money recorded as a transfer.", result: "Borrowed (received from loans); not Received income." },
    { label: "Repay principal", left: account("Checking · on budget", "bank"), right: account("Loan · off budget", "loan"), direction: "right", recorded: "Principal repaid as a transfer; the on-budget side carries a category.", result: "Loan principal repaid; not Spent." },
    { label: "Interest & fees", left: account("Checking · on budget", "bank"), right: other("Lender · outside payee"), direction: "right", impact: "spent", recorded: "Separate interest or fee entry with an expense category.", result: "Spent. Interest paid / Fees paid identified for tracked loans only." },
    { label: "Loan adjustment", left: other("Recorded charge"), right: account("Loan · off budget", "loan"), direction: "entry", recorded: "Uncategorized non-transfer entry, for example capitalized interest.", result: "Unidentified movements; not Interest paid or Spent." },
  ] },
  { name: "Credit cards", icon: ACCOUNT_CLASS_ICONS["credit-card"], placement: "On or off budget · Current liability", examples: [
    { label: "Card purchase", left: account("Card · on budget", "credit-card"), right: other("Grocery store · outside payee"), direction: "right", impact: "spent", recorded: "Purchase with a grocery category.", result: "Spent rises when recorded; card debt rises." },
    { label: "Pay card", left: account("Checking · on budget", "bank"), right: account("Card · on budget", "credit-card"), direction: "right", recorded: "Transfer to pay the card. Both accounts are on budget.", result: "Cash falls; not Spent again." },
    { label: "Off-budget card", left: other("Outside payee"), right: account("Card · off budget", "credit-card"), direction: "left", recorded: "Uncategorized non-transfer entry.", result: "Unidentified movements; not Spent." },
  ] },
  { name: "Property & assets", icon: ACCOUNT_CLASS_ICONS.property, placement: "Property and Vehicle classes are off budget · Fixed assets", examples: [
    { label: "Buy property", left: account("Checking · on budget", "bank"), right: account("Property · off budget", "property"), direction: "right", recorded: "Purchase recorded as a transfer; the on-budget side carries a category.", result: "Asset value rises; not Spent. Assets may classify Capital added." },
    { label: "Value change", left: other("Recorded value change"), right: account("Property · off budget", "property"), direction: "entry", recorded: "Entry classified in Assets as revaluation or depreciation.", result: "Revaluation / Depreciation when classified in Assets." },
    { label: "Link a loan", left: account("Loan · off budget", "loan"), right: account("Property · off budget", "property"), direction: "link", recorded: "The loan is linked to the asset in Assets. This link is not a transaction.", result: "Debt against assets and Equity in Property & assets." },
  ] },
  { name: "Other accounts", icon: ACCOUNT_CLASS_ICONS["other-liability"], placement: "Other Liability may be on or off budget; Excluded is off budget", examples: [
    { label: "Other liability", left: account("Checking · on budget", "bank"), right: account("Liability · off budget", "other-liability"), direction: "right", recorded: "A transfer to an Other Liability account; choose current or non-current in Financial Reporting.", result: "Other liabilities change; the transfer is not Spent." },
    { label: "Excluded account", left: account("Checking · on budget", "bank"), right: account("Excluded · off budget", "excluded"), direction: "right", recorded: "A transfer to an account excluded from Financial Insights.", result: "Transfers with excluded accounts: the excluded account is left out, so the movement changes the included balances and net worth." },
  ] },
];

const FLOW_CLASS_COLOURS: Partial<Record<AccountClass, string>> = {
  cash: "var(--fi-cash)", bank: "var(--fi-cash)", investment: "var(--fi-invest)", retirement: "var(--fi-invest)",
  loan: "var(--fi-loan)", "credit-card": "var(--fi-card)", property: "var(--fi-property)", vehicle: "var(--fi-vehicle)",
  "other-asset": "var(--fi-other-asset)", "other-liability": "var(--fi-other-liability)",
};
const FLOW_GROUP_COLOURS = ["var(--fi-cash)", "var(--fi-invest)", "var(--fi-loan)", "var(--fi-card)", "var(--fi-property)", "var(--fi-other-liability)"];

function FlowAccountNode({ node, align = "left" }: { node: FlowNode; align?: "left" | "right" }) {
  const Icon = node.accountClass ? ACCOUNT_CLASS_ICONS[node.accountClass] : node.label.includes("payee") ? UserRound : FilePenLine;
  const [name, placement] = node.label.split(" · ");
  return <span className={`flex min-w-0 items-start gap-1 ${align === "right" ? "justify-end text-right" : "text-left"}`}><Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" style={{ color: node.accountClass ? FLOW_CLASS_COLOURS[node.accountClass] : undefined }} aria-hidden="true" /><span>{name}{placement && <span className="text-muted-foreground"> ({placement === "outside payee" ? "payee" : placement})</span>}</span></span>;
}

/** Examples start with everyday activities; account-specific detail stays available on demand. */
function FlowOverview() {
  const basics: { title: string; text: string; tone: "income" | "spend" | "neutral" | "value"; icon: LucideIcon }[] = [
    { title: "Received", text: "Income from salary, business, interest or other sources recorded as income, plus uncategorized money in on budget. Borrowing and transfers are not income.", tone: "income", icon: Banknote },
    { title: "Spent", text: "Expenses paid in cash or on credit, usually from on-budget accounts, such as groceries or loan interest.", tone: "spend", icon: ShoppingCart },
    { title: "Money moved", text: "Transfers between your accounts, including money put into savings or investments and loan principal repaid.", tone: "neutral", icon: ArrowLeftRight },
    { title: "Value changed", text: "A recorded change in an asset’s value can change net worth without being income or spending.", tone: "value", icon: TrendingUp },
  ];
  const common = [
    { title: "Receive a salary", badge: "Received", left: other("Employer · outside payee"), right: account("Checking · on budget", "bank"), text: "Received and cash rise." },
    { title: "Buy groceries", badge: "Spent", left: account("Checking · on budget", "bank"), right: other("Grocery store · outside payee"), text: "Spent rises; cash and net worth fall." },
    { title: "Move money to savings", badge: "Transfer", left: account("Checking · on budget", "bank"), right: account("Savings · off budget", "bank"), text: "Cash moves between included accounts; total cash and net worth stay the same when both sides match in the period." },
    { title: "Repay loan principal", badge: "Transfer", left: account("Checking · on budget", "bank"), right: account("Loan · off budget", "loan"), text: "Cash and debt fall; principal is not Spent." },
  ];
  const order = [0, 3, 1, 2, 4, 5];
  return <div className="max-w-[55rem] space-y-4">
    <section aria-label="How your money is counted">
      <h3 className="text-sm font-semibold">How your money is counted</h3>
      <p className="mt-1 text-xs leading-relaxed text-foreground/80">Financial Insights separates income, expenses, transfers and changes in value.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{basics.map(({ title, text, tone, icon }) => <Card key={title} icon={icon} tone={tone} title={title}>{text}</Card>)}</div>
    </section>
    <section aria-label="Common money movements">
      <h3 className="text-sm font-semibold">Common money movements</h3>
      <div className="mt-2 divide-y divide-border/60">{common.map(({ title, badge, left, right, text }) => <div key={title} className="py-2 text-xs leading-relaxed">
        <div className="flex flex-wrap items-center justify-between gap-1"><p className="font-semibold">{title}</p><Chip tone={badge === "Received" ? "income" : badge === "Spent" ? "spend" : "neutral"}>{badge}</Chip></div>
        <div className="mt-1 grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-start font-medium"><FlowAccountNode node={left} /><span className="text-center text-muted-foreground" aria-label="to">→</span><FlowAccountNode node={right} align="right" /></div>
        <p className="mt-1 text-foreground/80">{text}</p>
      </div>)}</div>
      <aside className="mt-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs leading-relaxed"><b>Why My budget can differ:</b> When a transfer involves an off-budget account, Actual requires a category on its on-budget side and it can count the transfer as budget spending. Financial Insights excludes transfers from its <b>Spending</b> calculation, even when they have a category. For example, moving 500 from checking to an off-budget investment account can use 500 of a budget category, but adds nothing to Financial Insights’ <b>Spent</b>. The reconciliation in My budget shows the difference.</aside>
    </section>
    <section aria-label="Explore more examples">
      <h3 className="text-sm font-semibold">Explore more examples</h3>
      <div className="mt-2 space-y-2">{order.map((index) => {
        const group = FLOW_GROUPS[index];
        const Icon = group.icon;
        const colour = FLOW_GROUP_COLOURS[index];
        const subtitles = ["Savings, deposits and everyday banking", "Funding, withdrawals and account value changes", "Borrowing, principal and interest", "Purchases, payments and off-budget cards", "Purchases, valuations and linked debt", "Other liabilities and excluded accounts"];
        return <details key={group.name} className="overflow-hidden rounded-lg border">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs font-semibold marker:content-none"><Icon className="size-4 shrink-0" style={{ color: colour }} aria-hidden="true" /><span className="min-w-0 flex-1">{group.name}<span className="mt-0.5 block font-normal text-muted-foreground">{subtitles[index]}</span></span><span aria-hidden="true" className="text-muted-foreground">⌄</span></summary>
          <div className="border-t px-3 py-1"><p className="py-1 text-xs text-muted-foreground">{group.placement}</p><dl className="divide-y divide-border/60">{group.examples.map(({ label, left, right, direction, recorded, result }) => <div key={label} className="py-2 text-xs leading-relaxed">
            <dt className="grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-start font-medium"><FlowAccountNode node={left} /><span className="text-center text-muted-foreground" aria-label={direction === "right" ? "to" : direction === "left" ? "from" : direction === "link" ? "linked to" : "recorded in"}>{direction === "right" ? "→" : direction === "left" ? "←" : direction === "link" ? "+" : "→"}</span><FlowAccountNode node={right} align="right" /></dt>
            <dd className="mt-0.5 text-foreground/80">{!result.toLowerCase().startsWith(label.toLowerCase()) && <span className="font-medium text-foreground">{label}: </span>}{result}<span className="sr-only"> {recorded}</span></dd>
          </div>)}</dl></div>
        </details>;
      })}</div>
    </section>
  </div>;
}

export function FinancialInsightsGuide({ section, onSection, onClose, docsUrl }: { section: FinancialInsightsGuideSection; onSection: (section: FinancialInsightsGuideSection) => void; onClose: () => void; docsUrl?: string }) {
  const link = (to: FinancialInsightsGuideSection, text: string) => <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSection(to)}>{text}</button>;
  return (
    <GuideFrame title="Financial Insights guide" description="What every tab and card tells you, how each figure is worked out, and why it is more than a report." docsUrl={docsUrl}
      sections={FINANCIAL_INSIGHTS_GUIDE_SECTIONS} icons={SECTION_ICONS} section={section} onSection={onSection} onClose={onClose}>

      {section === "start" && <>
        <Para>Financial Insights is one read-only picture of your money: what you own and owe, what came in and went out, and <b>why</b> your cash and wealth changed. It reads your accounts and transactions from Actual and never changes them. Every figure follows the same definitions on every tab, so the number on one chart always agrees with the number on another.</Para>
        <Grid cols={4}>
          <Card icon={LayoutDashboard} tone="value" title="Summary">Net worth, how it changed and why, and how many months your cash would last. See {link("summary", "Summary")}.</Card>
          <Card icon={ArrowLeftRight} tone="kept" title="Money in & out">Received, spent, kept, and how your cash moved. See {link("money", "Money in & out")}.</Card>
          <Card icon={Banknote} tone="income" title="Income">Where the money that came in came from. See {link("income", "Income")}.</Card>
          <Card icon={ShoppingCart} tone="spend" title="Spending">Where the money went, by group, category and payee. See {link("spending", "Spending")}.</Card>
          <Card icon={Target} tone="kept" title="My budget">Did you stay on the plan you keep in Actual? See {link("budget", "My budget")}.</Card>
          <Card icon={TrendingUp} tone="value" title="Investments">What went in, what came out, what was recorded inside. See {link("investments", "Investments")}.</Card>
          <Card icon={Home} tone="value" title="Property & assets">Value, debt and equity of what you own. See {link("property", "Property & assets")}.</Card>
          <Card icon={CreditCard} tone="loan" title="Loans & cards">What you owe and what your payments are doing to it. See {link("loans", "Loans & cards")}.</Card>
        </Grid>
        <Para>Investments, Property &amp; assets and Loans &amp; cards appear only when you have such an account, and My budget once Bench can read your budget mode. Summary, Money in &amp; out, Income and Spending are always there.</Para>
        <Heading>How to read any tab</Heading>
        <Steps items={[
          ["Choose a period", "The control at the top applies to every tab. This month and This year are marked partial; the other presets are complete months only."],
          ["Read the five tiles", "Each tab opens with five headline figures. The (i) beside a label explains how it is worked out."],
          ["Look at the change", "A small ▲ or ▼ beside a figure compares it with the stretch of the same length just before. Hover it for the exact period."],
          ["Open the evidence", "Underlined figures, bars and cells open the real transactions behind them. See the transactions behind a figure."],
        ]} />
        <Grid cols={3}>
          <MiniTile label="Money kept" info value="12,000.00" detail="Received less spent" delta={{ text: "▲ 8.0%", good: true }} />
          <MiniTile label="Spent" info value="36,000.00" detail="Refunds lower it" delta={{ text: "▲ 2.1%", good: false }} />
          <MiniTile label="Savings rate" value="25.0%" detail="Of every 100 received: 75.0 spent" delta={{ text: "▲ 1.2 pts", good: true }} />
        </Grid>
        <Callout title="Nothing is changed in Actual">Everything is read-only. What Bench keeps itself (the class of each account, your cash buffer goal and scenarios) lives in Bench’s own database, never in your budget file.</Callout>
        <Para>New to the report? See {link("counted", "how things are counted")} from your accounts to the figures.</Para>
      </>}

      {section === "counted" && <>
        <FlowOverview />
        <details className="my-4 max-w-[55rem] rounded-xl border bg-card px-4 py-3 text-xs">
          <summary className="cursor-pointer font-semibold">Advanced: How Financial Insights classifies transactions</summary>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2">
            {([
              ["Transfers", ["Transfers are neither Received nor Spent in Financial Insights. Actual may count the on-budget category in My budget.", "A missing side or one outside the period can appear as In transit."]],
              ["Asset Registry entries", ["A revaluation or depreciation classified in Assets has its own value-change line.", "Proceeds linked to an asset sale have their own Asset sales line."]],
              ["Categories", ["Other categorized entries follow their category: income in an income category, spending otherwise.", "A refund in an expense category reduces spending; its sign does not make it income."]],
              ["On-budget, no category", ["Money in or out is counted by its sign and shown separately as uncategorized.", "Starting balances are not income."]],
              ["Off-budget, no category", ["A non-transfer entry in an investment or retirement account is Investment activity, not a calculated return.", "In another off-budget account it is an unidentified movement, unless Assets classifies it; neither is income or spending."]],
              ["Excluded accounts", ["The account’s balance and entries are left out of Financial Insights.", "Transfers between an excluded account and an included account appear on their own line."]],
            ] satisfies [string, string[]][]).map(([title, bullets], index) => <li key={title} className="flex gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 font-semibold text-primary">{index + 1}</span>
              <div className="min-w-0"><p className="font-semibold">{title}</p><ul className="mt-1.5 list-disc space-y-1 pl-4 leading-relaxed text-foreground/80">{bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul></div>
            </li>)}
          </ol>
        </details>
        <Callout title="When Money kept needs review">Money kept and the savings rate say <b>Needs review</b> when Assets classifies money put into an asset without a recorded transfer, the registry cannot be read, or an asset account has too many entries to read. Income, spending, net worth and balances still show.</Callout>
      </>}

      {section === "different" && <>
        <Para>Actual’s own reports are very good at one question: <i>what happened in these categories, accounts or payees over this time?</i> Financial Insights answers a different one: <b>why did my wealth and cash change, and am I safe?</b> That needs facts that are not in your transactions.</Para>
        <PipelineSketch />
        <Heading>What Financial Insights can do that a report of transactions cannot</Heading>
        <Example caption="Side by side" head={["Question", "A report of transactions", "Financial Insights"]} rows={[
          ["Why did net worth change?", "Shows balances at two dates", "Splits the change into money kept, investment activity, value changes, asset sales, transfers and what is in transit, and shows what it cannot explain"],
          ["Is a transfer income or spending?", "Depends on the filter you build", "Never: transfers are neither, in transit ones are listed with the reason, and accounts you exclude stay out"],
          ["What is a house or a car worth?", "Its account balance", "The Asset Registry’s own classified entries: purchases, improvements, revaluation, depreciation, sales"],
          ["What does a loan really cost?", "Repayments as spending", "Principal, interest and fees apart, from the schedule tracked in Loans, with the next 12 months"],
          ["Is a card’s interest spending?", "Mixed in with purchases", "Categorized interest is spending; the card-cost breakdown identifies it when interest and fee categories are configured"],
          ["How long would my cash last?", "No such figure", "Months of cover from cash and every loan repayment, with your own goal and what-if scenarios"],
          ["Are two totals the same thing?", "You check by hand", "Every figure opens its transactions and says Matches the figure, or by how much it differs"],
        ]} />
        <Heading>Why Actual cannot simply produce this</Heading>
        <Grid cols={3}>
          <Card icon={ShieldCheck} tone="value" title="It needs facts Actual does not hold">Whether an account is cash, an investment or a fixed asset, and whether it is current or non-current, is not recorded in Actual. Bench keeps it, and refuses to show a number until every account is understood.</Card>
          <Card icon={Scale} tone="income" title="It never forces a total">Where the parts do not add up, a dashed <b>Unexplained</b> bar shows the gap. A report that only totals what it is given cannot tell you something is missing.</Card>
          <Card icon={Lock} tone="kept" title="It does not touch your budget">Classes, goals and scenarios live in Bench’s own database. Your budget file is only read, so there is nothing to undo.</Card>
        </Grid>
        <WaterfallSketch label="Sketch of a net worth change explained in steps" steps={[
          { name: "Start", value: 100, kind: "total" }, { name: "Money kept", value: 18, kind: "up" }, { name: "Investment activity", value: 6, kind: "up" },
          { name: "Value change", value: -4, kind: "down" }, { name: "Unexplained", value: 2, kind: "gap" }, { name: "End", value: 122, kind: "total" },
        ]} />
        <Callout title="Same data, so the numbers agree with Actual">Spending in My budget is Actual’s own month figure, the same as Budget Cockpit. Where it differs from the Spending tab, a reconciliation box lists each reason with a link to its transactions.</Callout>
      </>}

      {section === "ready" && <>
        <Para>Financial Insights shows no figure until it understands every account. This is on purpose: a number built on a guess about what an account is would look exact and be wrong.</Para>
        <ReadinessSketch />
        <Steps items={[
          ["Every account has a class", "Its own, or its group’s: cash & bank, credit card, loan, investment, property and so on. Set in the Accounts table, Class column."],
          ["Some need a choice", "Every Investment, Other Asset and Other Liability account says whether it is current or non-current (Financial Reporting column). A fixed asset counts as property."],
          ["The page tells you what is missing", "It lists the accounts that need attention with an Open Accounts button. When you come back it checks again by itself."],
          ["It locks again if something new appears", "A new unclassified account removes the figures until it is classified. A closed account with no transactions and a zero balance needs nothing."],
        ]} />
        <Heading>The period</Heading>
        <Example caption="What each period covers" head={["Period", "What it covers"]} rows={[
          ["This month, This year", "From the start to today. Marked partial."],
          ["Last month, Last 6 months, Last 12 months, Last 2 years, Last year", "Complete months only, so averages and charts compare like with like."],
          ["All available", "From your first transaction to today."],
          ["Custom range", "Any run of months, up to the current one."],
        ]} />
        <Para>Nothing dated after today is counted, even later this month. Balances are measured at each month end, and the current month runs to today. A budget with no transactions up to today shows <i>There is nothing to show yet</i>, never a page of zeros.</Para>
      </>}

      {section === "summary" && <>
        <Para>The Summary is the whole picture in one screen: where you stand, how that changed, why, and how long your cash would last.</Para>
        <Tiles>
          <MiniTile label="Net worth" value="214,200" detail="Owns 394,200 · owes 180,000" />
          <MiniTile label="Change in net worth" info value="+14,200" detail="+7.1% over 10 months" />
          <MiniTile label="Money kept" info value="12,000" detail="48,000 received − 36,000 spent" delta={{ text: "▲ 8.0%", good: true }} />
          <MiniTile label="Change in cash" value="+6,400" detail="Cash & bank, end less start" />
          <MiniTile label="Savings rate" value="25.0%" detail="Money kept ÷ money received" delta={{ text: "▲ 1.2 pts", good: true }} />
        </Tiles>
        <Heading>What you own and owe, month by month</Heading>
        <OwnAndOweSketch />
        <Para>Assets are stacked above zero by class, liabilities below, and net worth is the line. Mo, Qtr and Yr show the balance at the end of each month, quarter or year; the chart opens in the unit that suits the length of the period. Select a class in the legend to take it out of the bars. The net worth line always stays the true total.</Para>
        <Heading>What changed your net worth</Heading>
        <WaterfallSketch label="Sketch of what changed net worth" steps={[
          { name: "Start", value: 100, kind: "total" }, { name: "Money kept", value: 18, kind: "up" }, { name: "Investment activity", value: 6, kind: "up" },
          { name: "Value change", value: -4, kind: "down" }, { name: "End", value: 120, kind: "total" },
        ]} />
        <Para>The first and last bars are net worth at the start and the end; the steps between are what Bench can identify: money kept, unidentified movements, investment activity, changes in value and asset sales from Assets, opening balances, transfers with excluded accounts and money in transit. When they add up exactly you see a <Chip tone="income">Reconciled</Chip> mark, otherwise a dashed <b>Unexplained</b> bar shows the difference. The axis does not start at zero so the steps stay readable.</Para>
        <Heading>The three measures people confuse</Heading>
        <Example caption="Money kept, change in cash and change in net worth" head={["Measure", "What it is", "Why it differs"]} rows={[
          ["Money kept", "Income − spending", "Moving money into investments or paying loan principal is not spending"],
          ["Change in cash", "Cash & bank, end − start", "Moves after investments, card payments, loans and transfers: it can fall even when you kept money"],
          ["Change in net worth", "Everything owned − everything owed, end − start", "Adds changes in value and anything Bench cannot place, shown in the waterfall"],
        ]} />
        <Heading>Start and end, and your cash buffer</Heading>
        <Para><b>What you own and owe, start and end</b> compares balances before the period with the balances at its end, by class. Open a class with its chevron to see its accounts with their treatment, largest first. <b>Your cash buffer</b> shows how many months your cash would cover; it has its own section: {link("buffer", "Cash buffer & scenarios")}.</Para>
      </>}

      {section === "money" && <>
        <Para>Money in &amp; out follows the money itself: what you received, what you spent, what was left, and how your cash moved.</Para>
        <Tiles>
          <MiniTile label="Received" value="48,000" detail="Income in the period" delta={{ text: "▲ 3.2%", good: true }} />
          <MiniTile label="Spent" value="36,000" detail="Refunds lower it" delta={{ text: "▲ 2.1%", good: false }} />
          <MiniTile label="Kept from income" value="12,000" detail="Received less spent" delta={{ text: "▲ 8.0%", good: true }} />
          <MiniTile label="Savings rate" value="25.0%" detail="75.0 spent · 25.0 kept" />
          <MiniTile label="Change in cash" value="+6,400" detail="End of the period less the start" />
        </Tiles>
        <Heading>Money in, money out</Heading>
        <FlowSketch />
        <Para>Received rises above the line, spent hangs below it, and what you kept is a dashed line with a marker for each month. Nothing is stacked, so nothing is counted twice. Quarters and years add up their months; one the period only partly covers is marked * and drawn lighter.</Para>
        <Heading>Cash change, one step at a time</Heading>
        <WaterfallSketch label="Sketch of how cash moved" steps={[
          { name: "Cash at start", value: 100, kind: "total" }, { name: "Income", value: 40, kind: "up" }, { name: "Spending", value: -30, kind: "down" },
          { name: "Invested", value: -10, kind: "down" }, { name: "Loans", value: -6, kind: "down" }, { name: "Cash at end", value: 94, kind: "total" },
        ]} />
        <Para>A waterfall from your cash at the start to your cash at the end. Income and spending in cash accounts are two steps, each opening its transactions. Whatever the steps do not explain stays visible as <b>Unattributed</b>; it is never forced to zero. Everyday movements and loans have separate panels so a large borrowing cannot hide the rest.</Para>
        <Grid cols={3}>
          <Card icon={ArrowLeftRight} tone="warn" title="In transit">Transfers with only one side recorded, or with the other side outside the period, listed with the reason from what is recorded. Bench never guesses a cause.</Card>
          <Card icon={TrendingUp} tone="value" title="Investments and loan principal">Money put into and withdrawn from investments, and what left cash for loans, each on its own scale so one cannot flatten the other.</Card>
          <Card icon={CreditCard} tone="loan" title="Loan repayments">Each loan’s principal, interest and fees. Principal is a repayment, not an expense; interest and fees are expenses already in Spent.</Card>
        </Grid>
        <Para><b>Other movements</b> lists entries that are not plain income or spending. An entry with no category in an investment or retirement account is <b>investment activity</b> (a price change, dividend, interest or fee): it changes net worth, is not income or spending, and no return is calculated.</Para>
      </>}

      {section === "income" && <>
        <Para>Income is the other half of Spending: where the money that came in came from. It is <b>money received</b>, what actually arrived in your accounts, not the income you budgeted. It uses the same definition as <i>Received</i> on Money in &amp; out, so the two totals are always equal.</Para>
        <Tiles>
          <MiniTile label="Total received" value="48,000" detail="Net of refunds of income" delta={{ text: "▲ 3.2%", good: true }} />
          <MiniTile label="Monthly average" value="4,800" detail="Over 10 complete months" />
          <MiniTile label="Largest source" value="Salary" detail="43,200 · 90.0% of income" />
          <MiniTile label="Highest month" value="8,400" detail="May 2026" />
          <MiniTile label="Recent pace" value="+1.8%" detail="Latest three months against the earliest three" />
        </Tiles>
        <Heading>Income each month</Heading>
        <StackedSketch label="Sketch of income by category and month" groups={[
          { name: "Salary", colour: "var(--fi-g1)", values: [60, 60, 60, 60, 62, 62] }, { name: "Bonus", colour: "var(--fi-g2)", values: [0, 0, 14, 0, 0, 26] }, { name: "Other", colour: "var(--fi-g0)", values: [8, 6, 5, 9, 6, 7] },
        ]} />
        <Para>Income is listed by category, not by the group Actual keeps it in. Select a segment to see that category’s transactions for the month, quarter or year. Money in with no category in an on-budget account is shown as <b>Uncategorized</b>.</Para>
        <Grid cols={3}>
          <Card icon={Banknote} tone="income" title="Where the money came from">Each income category with what it brought in and its share of all income, sortable by Actual order, income or name.</Card>
          <Card icon={PieChart} tone="income" title="Category by month">A heatmap with each cell shaded against that row’s own average, with the same Mo, Qtr and Yr buttons as Spending.</Card>
          <Card icon={Banknote} tone="income" title="Frequent payers">Who paid you most, with the number of entries and the average. Entries with no payer are shown below.</Card>
        </Grid>
        <Callout title="Not income">Transfers between your accounts, borrowing, opening balances, and entries the Asset Registry has since classified (a sale, a change in value) are left out.</Callout>
      </>}

      {section === "spending" && <>
        <Para>Spending shows where the money went. Its total equals <i>Spent</i> on Money in &amp; out exactly: refunds lower a category, income is out, and spending with no category is its own row.</Para>
        <Tiles>
          <MiniTile label="Total spent" value="36,000" detail="75.0% of what you received" delta={{ text: "▲ 2.1%", good: false }} />
          <MiniTile label="Monthly average" value="3,600" detail="Over 10 complete months" />
          <MiniTile label="Largest group" value="Housing" detail="14,400 · 40.0% of spending" />
          <MiniTile label="Highest month" value="4,900" detail="Jul 2026" />
          <MiniTile label="Recent pace" value="+6.5%" detail="Latest three months against the earliest three" />
        </Tiles>
        <Heading>Spending each month</Heading>
        <StackedSketch label="Sketch of spending by category group and month" groups={[
          { name: "Housing", colour: "var(--fi-g1)", values: [32, 32, 32, 32, 32, 32] }, { name: "Food", colour: "var(--fi-g2)", values: [20, 22, 18, 24, 21, 19] },
          { name: "Travel", colour: "var(--fi-g3)", values: [0, 0, 24, 0, 0, 12] }, { name: "Other groups", colour: "var(--fi-g10)", values: [10, 12, 8, 11, 14, 9] },
        ]} />
        <Para>The ten largest groups in the period have a colour of their own and every other group is “Other groups”; the colours are the same everywhere on the tab, and in the cash buffer simulator. A partial month is drawn lighter with a dashed outline.</Para>
        <Heading>Category by month</Heading>
        <HeatSketch rows={[{ name: "Groceries", cells: [0, 0, 1, -1, 0, 2] }, { name: "Utilities", cells: [0, 0, 0, 0, 1, 0] }, { name: "Dining out", cells: [-1, 0, 2, 0, -2, 0] }]} />
        <Para>Each cell is shaded against that row’s own average over the complete months, so a quiet category and a busy one are comparable. A ▼ or ▲ marks a month 25% or more below or above its usual. Select a cell to see its transactions. A switch above chooses between this grid and <b>Frequent payees</b>, ranked by amount, with entries that have no payee shown separately.</Para>
        <Grid cols={2}>
          <Card icon={ShoppingCart} tone="spend" title="Where the money went">All groups, sortable by Actual order, spending or name; select a total for its transactions, or expand a group for its categories.</Card>
          <Card icon={PieChart} tone="spend" title="Hidden categories">Spending includes hidden categories, because hiding a category does not mean the money was not spent. My budget leaves them out of Actual’s Tracking totals and says so.</Card>
        </Grid>
      </>}

      {section === "budget" && <>
        <Para>My budget answers “did I stay on my plan?” from the plan you already keep in Actual. It reads Actual’s own setting, so it knows whether your budget is <b>Tracking</b> or <b>Envelope</b>, and every plan and spent figure is Actual’s own: it matches Budget Cockpit for the same month and category.</Para>
        <Tiles>
          <MiniTile label="Expenses budgeted" value="36,500" detail="Saved budget, 10 completed months" />
          <MiniTile label="Expenses spent" info value="37,200" detail="10 completed months counted" />
          <MiniTile label="Expense variance" value="−700" tone="spend" detail="Over by: budgeted less spent" />
          <MiniTile label="Months over budget" value="6 of 10" detail="Completed months with a budget" />
          <MiniTile label="Income variance" value="+300" tone="income" detail="Above by: received less budgeted" />
        </Tiles>
        <Para>The tiles add up the <b>completed months only</b>; the current month is shown in charts and tables but never counted. In an Envelope budget the tiles are Budgeted, Expenses spent, Overspent not covered, Months needing adjustment and Ending balance (the sum of category balances, not a bank balance).</Para>
        <Heading>Budgeted against spent</Heading>
        <BudgetLineSketch />
        <Para>Each month is a pale block for the budget with the spending as a bar in front of it: green while it stays inside the block, red once it rises above (in an Envelope budget, red only when earlier money did not cover the overspending), with how far under (+) or over (−) in a row beneath. The same colours are used for the lines: one line per group (and per category when you expand it) on a shared scale, where green is spending within the budget, pale is budget not spent and red is spending beyond it. Spending with no budget saved is all red, because Actual returns 0 both for no budget and for a budget of 0.</Para>
        <Heading>Category by month, in the budget’s own terms</Heading>
        <HeatSketch symbols rows={[{ name: "Groceries", cells: [-1, 0, 1, 2, 0, -2] }, { name: "Dining out", cells: [0, 2, 2, 0, -1, 0] }]} />
        <Grid cols={3}>
          <Card icon={Target} tone="kept" title="Tracking">▼ under, = on, ▲ over its saved plan, ○ unplanned spending.</Card>
          <Card icon={Target} tone="kept" title="Envelope">Covered, ↷ carried to next month, or ! uncovered (Actual takes it from next month).</Card>
          <Card icon={Scale} tone="warn" title="Reconciliation to Spending">Actual’s spending and the Spending tab’s differ on purpose; the box lists each reason with a link, and shows what it cannot explain as Other.</Card>
        </Grid>
        <Para>Where the budget was missed (Tracking) or where funds ran short (Envelope) ranks categories or groups by how often and how far, with the longest run of months in a row. A month Actual does not have, or that could not be read, is a gap, never zero. Bench reads one budget month per month of the period when you open the tab, through the same cache as Budget Cockpit, so a long period takes longer to open.</Para>
      </>}

      {section === "investments" && <>
        <Para>Investments answers “what have my investments built up, and what did they add?” It never shows a percentage or annualised return: it shows what went in, what came out, what was recorded inside, and what is left unexplained.</Para>
        <Tiles>
          <MiniTile label="Investments" info value="28,400" detail="+9.3% during the period" />
          <MiniTile label="Put in" info value="6,000" detail="From outside your investments" />
          <MiniTile label="Withdrawn" info value="1,500" detail="To outside your investments" />
          <MiniTile label="Investment activity" info value="+1,800" detail="Recorded inside: not a return" />
          <MiniTile label="Share of your assets" value="7.2%" detail="28,400 of 394,200 owned" />
        </Tiles>
        <WaterfallSketch label="Sketch of what changed your investments" steps={[
          { name: "Start", value: 100, kind: "total" }, { name: "Funding", value: 26, kind: "up" }, { name: "Withdrawals", value: -6, kind: "down" },
          { name: "Activity", value: 8, kind: "up" }, { name: "End", value: 128, kind: "total" },
        ]} />
        <Para>The bridge runs from the value at the start to the value at the end, one line at a time: funding and withdrawals are money moved between these accounts and anything outside them, and investment activity is what was recorded inside. If the lines do not reach the end value the difference is shown as Unexplained. Also on the tab: your wealth over time (net worth, the assets behind it and the debts deducted), the portfolio’s value and changes by month, and an account-by-account table with the same lines.</Para>
        <Callout title="Why no return?">An entry with no category in an investment account is investment activity: a price change, a dividend, interest or a fee. Bench records that it happened but cannot tell which, so it does not pretend to know a return.</Callout>
      </>}

      {section === "property" && <>
        <Para>Property &amp; assets answers “what are my property and other fixed assets worth, what is owed against them, and what is left?” It appears once you have a property, vehicle or fixed other-asset account.</Para>
        <Tiles>
          <MiniTile label="Asset value" info value="310,000" detail="+3.3% during the period" />
          <MiniTile label="Change in value" value="+10,000" detail="Revaluation +10,000 · depreciation 0" />
          <MiniTile label="Debt against assets" info value="180,000" detail="−6,500 during the period" />
          <MiniTile label="Equity" info value="130,000" detail="+16,500 (+14.5%) during the period" />
          <MiniTile label="Loan-to-value" value="58.1%" detail="Debt as a share of the linked assets’ value" />
        </Tiles>
        <EquitySketch />
        <Para><b>Asset value</b> is the balance of your fixed asset accounts in Actual. The value history comes from the Asset Registry, the same as the Assets page, with the balances of linked loans in Actual. Once a loan is linked to an asset, debt, equity and loan-to-value have figures; without a link they say <i>Not linked</i>, and when an input is missing they say <i>Unavailable</i>, never zero.</Para>
        <Grid cols={3}>
          <Card icon={Home} tone="value" title="What changed the value">A waterfall of the registry’s own bridge: capital added, revaluation, depreciation, disposal and other.</Card>
          <Card icon={Building2} tone="loan" title="Value, loan and equity by asset">One bar per asset on a shared scale, split into equity and what is still owed, with loan-to-value and a link to Loans &amp; cards.</Card>
          <Card icon={ListChecks} tone="kept" title="Needs review">An asset that is not in the registry, or whose book does not reconcile, says so and is named, never silently dropped.</Card>
        </Grid>
      </>}

      {section === "loans" && <>
        <Para>Loans &amp; cards shows what you still owe and what your payments are doing to it. The five tiles are the same for everyone: a group you do not have says <b>None</b>.</Para>
        <Tiles>
          <MiniTile label="You owe" info value="180,000" detail="−6,500 during the period" />
          <MiniTile label="Loans" value="172,000" detail="95.6% of what you owe" />
          <MiniTile label="Credit cards" value="5,400" detail="3.0% of what you owe" />
          <MiniTile label="Other liabilities" value="2,600" detail="1.4% of what you owe" />
          <MiniTile label="Interest & fees paid" info value="7,300" detail="Loans 7,100 · cards 200" />
        </Tiles>
        <Heading>What your loan payments did</Heading>
        <StackedSketch label="Sketch of principal, interest and fees by month" groups={[
          { name: "Principal", colour: "var(--fi-invest)", values: [40, 40, 41, 41, 42, 42] }, { name: "Interest", colour: "var(--fi-gap)", values: [20, 20, 19, 19, 18, 18] }, { name: "Fees", colour: "var(--fi-g2)", values: [3, 0, 0, 3, 0, 0] },
        ]} />
        <Para>Principal lowers what you owe and is not spending; interest and fees are spending already counted in Spending. Interest and fees are only identified for loans <b>tracked in Loans</b>; an untracked loan shows principal only and says so.</Para>
        <Example caption="The account table" head={["Column", "What it says"]} rows={[
          ["Start, End, Change", "What was owed before the period and at its end"],
          ["Share", "Each account’s part of everything you owe"],
          ["Principal repaid", "What was paid into the loan in the period (select it for the transactions)"],
          ["Next 12 months, Later", "Only for a tracked loan whose schedule agrees with Actual: the scheduled principal of the coming year, and what is owed after it. Otherwise Not scheduled, or Review in Loans with the reason"],
        ]} />
        <Grid cols={2}>
          <Card icon={CreditCard} tone="loan" title="What you owe on credit cards">The five largest cards in their own colours and the rest as “Other cards”, with the total as a line.</Card>
          <Card icon={CreditCard} tone="loan" title="Interest & fees on credit cards">Only where the interest or fee category is set for that card in Credit Cards. A card with neither is named as not identified, and none is guessed.</Card>
        </Grid>
      </>}

      {section === "statements" && <>
        <Para>The statements use the global reporting period in Tracking and Envelope mode. Budget plans, assignments, holds and carryover do not enter these statements. Each section keeps its heading, indented contents and subtotal together.</Para>
        <Grid cols={2}>
          <Card icon={Banknote} tone="income" title="Cash Flow Statement">Operating, investing and financing activities, followed by unclassified movements and adjustments. Opening and closing cash include Cash and Bank cash equivalents, on or off budget; fixed / restricted deposits are excluded.</Card>
          <Card icon={Scale} tone="value" title="Income Statement (P&L)">Actual categories in budget order, including hidden categories. Category groups start collapsed: select a chevron or group name to expand its indented categories. Use Expand all or Collapse all to change all category groups. Select an underlined group or category amount to see the transactions.</Card>
        </Grid>
        <Example caption="The same transaction in two statements" head={["Recorded movement", "Cash flow", "P&L"]} rows={[
          ["Categorized card purchase", "No cash movement", "Expense when recorded"],
          ["Ordinary cash settlement of a card", "Operating payment", "No second expense"],
          ["Transfer into investments or a restricted deposit", "Investing", "Excluded"],
          ["Recorded loan split", "Principal financing; paid interest operating", "Recorded interest expense"],
          ["Unsplit loan payment", "Allocation unidentified", "Transfer excluded; no estimated interest"],
          ["Uncategorized on-budget cash entry", "Operating receipt or payment", "Uncategorized income or expense by sign"],
          ["Uncategorized on-budget card purchase", "No cash movement", "Uncategorized expense when recorded"],
          ["Uncategorized entry inside off-budget investments", "No available-cash movement", "Investment activity, outside P&L and exceptions"],
        ]} />
        <Callout title="Reconciliation and classification are separate">Opening cash plus movements and adjustments equals closing cash. A statement can reconcile while some purposes remain unidentified. Starting balances introduced in the period, unmatched cash transfers and unexplained differences stay visible, even when unmatched transfers net to zero. Missing evidence never becomes a fabricated balancing entry.</Callout>
        <Heading>From P&L surplus to cash movement</Heading>
        <Para>The bridge adjusts surplus for card purchases versus settlements, income and expenses in other noncash accounts, investing, financing and unresolved cash movements. P&amp;L follows the existing income and spending rules: uncategorized on-budget money counts by sign in its own income or expense group, including card purchases. Transfers, principal, starting balances, registry-classified asset capital, value changes and linked sales stay outside P&amp;L. Recorded categorized charges count when posted; projected schedules and estimated accruals never count.</Para>
        <Heading>Balance Sheet</Heading>
        <Para>The balance sheet groups included account balances at the period end by current and non-current treatment. Classifications start open, showing Actual account groups and a No Group section. Select an account group to reveal its accounts and Financial Reporting treatments. Select a classification to collapse or reopen it. Expand all opens every classification and account group; Collapse all hides the accounts. Fixed / restricted deposits are shown as non-current assets. Loans are shown as non-current without estimating the portion due within a year. Net worth is assets less liabilities: a calculated residual, not retained earnings or an independent reconciliation. Current classifications also apply to historical periods; excluded accounts are omitted.</Para>
        <Heading>Investment activity</Heading>
        <Para>Uncategorized non-transfer entries in off-budget Investment and Retirement accounts have their own neutral card, transaction list and CSV. They can be recorded gains, losses, dividends, interest or fees. They are outside P&amp;L and available-cash movements, and are not classification exceptions. No realized profit or calculated return is inferred.</Para>
        <Para>Other assets and liabilities can need a purpose beyond current/non-current. An unlinked asset acquisition or unavailable asset evidence makes P&amp;L need review, with provisional category totals still visible. Classification exceptions shows the supporting entries and reasons.</Para>
        <Heading>Rules, accounts and exports</Heading>
        <Example caption="Account classification rules" head={["Class", "Statement treatment"]} rows={[
          ["Cash", "Cash balance; categorized receipts/payments and uncategorized on-budget receipts/payments are operating."],
          ["Bank", "Cash balance unless fixed / restricted; fixed-deposit transfers are investing."],
          ["Vehicle", "Cash purchases / capital and transfers received are investing. Value changes stay out of P&L."],
          ["Property", "Cash purchases / capital and transfers received are investing. Categorized rents and costs enter P&L."],
          ["Investment", "Cash funding and withdrawals are investing. Uncategorized internal activity stays outside P&L."],
          ["Retirement", "Cash funding and withdrawals are investing. Uncategorized internal activity stays outside P&L."],
          ["Other asset", "Fixed-asset cash transfers are investing. Other transfers need an identified purpose."],
          ["Credit card", "Purchases enter P&L once, including uncategorized on-budget payments. Ordinary settlements are operating; cash receipts need a purpose."],
          ["Loan", "Borrowing is financing. Recorded split principal is financing; unsplit payment composition needs review."],
          ["Other liability", "Current / non-current does not identify borrowing versus payables; transfers need review."],
          ["Excluded", "Activity excluded. Its cash counterpart is a scope exception."],
        ]} />
        <Para>Current saved account classifications apply to historical periods. Select Opening cash or Closing cash in the Cash Flow Statement to see opening and closing balances by account class and account group, including closed-account history. Expand individual groups or use Expand all, and export the breakdown. Individual card CSV exports preserve the reporting period and reporting basis. Underlined figures open exact recorded transactions and check their total against the figure.</Para>
      </>}

      {section === "buffer" && <>
        <Para>The cash buffer on the Summary tab answers “if my income stopped, how many months could I cover?”. It is always as of today, whatever period is selected.</Para>
        <BufferSketch />
        <Example caption="How the real figure is worked out" head={["Part", "What it is"]} rows={[
          ["Cash", "Cash & bank today. Investments and fixed or restricted deposits are not cash"],
          ["Spending per month", "A typical month of recorded spending, without the interest and fees of tracked loans"],
          ["Loan repayments", "Each loan you owe, in full: its scheduled repayment (principal and interest) if it is tracked and agrees with Actual, otherwise its recent recorded repayments (principal only)"],
          ["Months of cover", "Cash ÷ (spending per month + loan repayments)"],
        ]} />
        <Callout title="Is the loan interest counted twice?">No. The interest and fee lines of tracked loans are taken out of the spending categories, because each loan’s scheduled repayment already contains them. In the simulator that category is not listed at all.</Callout>
        <Heading>Your goal and a typical month</Heading>
        <Para>The sliders button on the card sets the <b>goal</b> (3, 6, 12 or any number of months) and how a <b>typical month</b> is taken: over the last 3, 6 or 12 complete months, as the average or the median. The median of each category ignores a month that was unusually high or low, so one big one-off does not move what a typical month costs. The card then marks your goal on the bar and tells you how far you are, in months and in cash. These settings apply to the real buffer and every scenario.</Para>
        <Heading>Simulate</Heading>
        <Steps items={[
          ["Open Simulate", "From the card. A dialog lists every group and category with a checkbox, a bar in the group’s colour, its share of the monthly need, its typical amount and your own."],
          ["Untick, or type", "Untick what you would not spend, or type another monthly amount. Set a group’s total and its categories keep their shares. Loan repayments can be left out or changed too."],
          ["Watch the result", "The panel shows the months of cover, the need per month and the cash against the real figure, and your goal, as you work."],
          ["Save it", "Name it and Save and show. You can keep several scenarios; the selector on the card switches between Actual and any of them."],
        ]} />
        <Para>Select a typical amount to see its transactions without leaving the dialog. A saved scenario keeps what it came to when it was saved, so the card can tell you how it has moved since. Scenarios are kept by Bench for this budget; they never change Actual or the real buffer. Sort the list by budget order, spend or name, and use the checkbox in the header to tick or untick every category shown.</Para>
      </>}

      {section === "drill" && <>
        <Para>Every figure with an underline, every bar, stacked segment, waterfall step and heatmap cell opens a read-only list of the real transactions behind it, with the usual search and sort. A segment or cell opens exactly that group or category in exactly that month.</Para>
        <DrillSketch />
        <Grid cols={3}>
          <Card icon={MousePointerClick} tone="value" title="It checks itself">The footer compares what is listed with the figure you clicked: <b>Matches the figure</b>, or <b>Differs from the figure by …</b>. Once you narrow the list with a filter it says so instead.</Card>
          <Card icon={PieChart} tone="income" title="Charts above the list">For money received and spent, charts show where it came from or went and when (weeks, months or years, with the average). Select a row or bar to narrow the list; Ctrl or Cmd-click for several.</Card>
          <Card icon={Lock} tone="kept" title="Nothing can be changed">The list is read-only. Balances and unattributed amounts have no list, because they are not made of transactions.</Card>
        </Grid>
        <Heading>On every chart</Heading>
        <Example caption="Buttons and marks" head={["Control", "What it does"]} rows={[
          ["Mo, Qtr, Yr", "Shows the card by month, quarter or year. It opens in the unit that suits the period, and your own choice holds for that period"],
          ["CSV", "Exports the exact figures with the period and the as-of date"],
          ["View data", "Opens the same figures as a table under the chart"],
          ["(i)", "Explains the chart or figure in full"],
          ["* and a lighter bar", "A partial month or period, not compared with whole ones"],
          ["▲ ▼ vs previous", "The change against the stretch of the same length just before; hover for the exact period"],
        ]} />
        <Para>A month that has no data is unavailable, never zero. Bench reads your transactions each time you open the page and when you press <b>Refresh</b>, which first pulls the latest budget from the server. Charts reuse that read. Statements additionally reads detailed evidence when opened for a reporting period, then reuses it until Refresh.</Para>
      </>}

      {section === "glossary" && <>
        <Example caption="Terms used on the page" head={["Term", "Meaning"]} rows={[
          ["Account class", "What kind of account it is: cash & bank, credit card, loan, investment, property and so on. Set in Accounts"],
          ["Financial Reporting", "Whether an investment, other asset or other liability is current or non-current, and which other assets are fixed"],
          ["Net worth", "Everything you own less everything you owe"],
          ["Money kept", "Money received less money spent"],
          ["Savings rate", "Money kept as a share of money received"],
          ["Change in cash", "How your cash & bank balance moved from the start to the end"],
          ["In transit", "A transfer with only one side recorded, or whose other side falls outside the period"],
          ["Investment activity", "An uncategorized non-transfer entry in an investment account: a price change, dividend, interest or fee. Not a return; transfers between investment accounts are separate"],
          ["Unidentified movement", "An uncategorized non-transfer entry in an off-budget account other than an investment or retirement account, unless Assets classifies it. Shown on its own"],
          ["Reconciled / Unexplained", "Whether the identified steps add up to the change, or by how much they do not"],
          ["Partial month", "The month still running, drawn lighter and not compared with whole months"],
          ["Typical month", "A category’s average or median over the last 3, 6 or 12 complete months"],
          ["Months of cover", "Cash ÷ what you need each month"],
          ["Goal", "The months of cover you aim for, marked on the bar"],
          ["Scenario", "Your own what-if of the cash buffer, saved by name"],
          ["Tracked loan", "A loan tracked in Loans whose schedule agrees with its account in Actual"],
        ]} />
        <Para>Some of these have their own settings: the account class and treatment in {link("ready", "Before any number")}, the goal and typical month in {link("buffer", "Cash buffer & scenarios")}. A quick reminder of the identities: <Tag>net worth change = money kept + identified steps + unexplained</Tag>.</Para>
      </>}
    </GuideFrame>
  );
}
