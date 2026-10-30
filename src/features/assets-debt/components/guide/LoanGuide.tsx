"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, BookOpen, Calculator, CalendarDays, CircleHelp, FileText, Landmark, Lightbulb, Link2, ListChecks, PanelTop, Scale, Settings2, ShieldCheck, Split, TriangleAlert, Wallet, type LucideIcon } from "lucide-react";
import { GuideFrame } from "@/components/ui/guide-frame";
import { cn } from "@/lib/utils";
import { Key, Tag } from "@/features/credit-cards/components/guide/CreditCardGuide";
import { Example, Heading, Para, Steps } from "@/components/ui/guide-primitives";
import { StatusBadge } from "../loan/presentation";
import type { WorkspaceTab } from "../workspace/WorkspaceFrame";
import { LoanSettingsGuide } from "./LoanSettingsGuide";

/**
 * The Loans & Debt guide: one dialog, the picture first and the words second, with one example loan throughout
 * (a 350,000 loan over 4 years, repaid monthly from a bank account into an off-budget loan account).
 */

export type LoanGuideSection = "start" | "calculator" | "events" | "method" | "link" | "repayments" | "split" | "ledger" | "assets" | "scenarios" | "safety" | "settings" | "glossary";
export const LOAN_GUIDE_SECTIONS: [LoanGuideSection, string][] = [
  ["start", "Getting started"], ["calculator", "Terms & Schedule"], ["events", "Events and what-ifs"], ["method", "Calculation method"],
  ["link", "Link to Actual"], ["repayments", "Repayments"], ["split", "How a split works"], ["ledger", "Loan Ledger"], ["assets", "Linked Assets"],
  ["scenarios", "Common situations"], ["safety", "What Bench writes"], ["settings", "Settings"], ["glossary", "Glossary"],
];
const SECTION_ICONS: Record<LoanGuideSection, LucideIcon> = {
  start: BookOpen, calculator: Calculator, events: CalendarDays, method: Settings2, link: Link2,
  repayments: ListChecks, split: Split, ledger: FileText, assets: Landmark, scenarios: Lightbulb,
  safety: ShieldCheck, settings: PanelTop, glossary: CircleHelp,
};

/** The guide section that explains the loan tab you are on. */
export const guideSectionForLoanTab = (tab: WorkspaceTab | null): LoanGuideSection => (
  tab === "calculation" ? "calculator" : tab === "setup" ? "link" : tab === "activity" ? "repayments" : tab === "ledger" ? "ledger" : tab === "assets" ? "assets" : "start");

type Tone = "loan" | "bank" | "interest" | "principal" | "calc" | "muted";
const TONES: Record<Tone, string> = {
  loan: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  bank: "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  interest: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  principal: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  calc: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  muted: "border-border bg-muted/40 text-foreground",
};

function Callout({ tone = "tip", title, children }: { tone?: "tip" | "warn"; title: string; children: ReactNode }) {
  const Icon = tone === "tip" ? Lightbulb : TriangleAlert;
  return <aside className={cn("my-4 flex max-w-[55rem] gap-3 rounded-xl border px-4 py-3.5 text-xs", tone === "tip" ? "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20" : "border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20")}>
    <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "tip" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400")} aria-hidden />
    <div><p className="font-semibold">{title}</p><div className="mt-1 leading-relaxed text-foreground/80">{children}</div></div>
  </aside>;
}
const Card = ({ icon: Icon, title, children, tone }: { icon: typeof Landmark; title: string; children: ReactNode; tone: Tone }) => (
  <div className={cn("rounded-xl border p-4 shadow-sm", TONES[tone])}><div className="flex items-center gap-2 text-xs font-semibold"><Icon className="size-4" aria-hidden />{title}</div><div className="mt-2 text-xs leading-relaxed text-foreground/80">{children}</div></div>
);
const Tile = ({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: Tone }) => (
  <div className={cn("rounded-xl border px-4 py-3 shadow-sm", tone ? TONES[tone] : "bg-card")}><p className="text-[11px] opacity-80">{label}</p><p className="mt-1 text-base font-semibold tabular-nums">{value}</p><p className="mt-1 text-[11px] opacity-80">{detail}</p></div>
);
/** A transaction as Actual shows it, drawn small. */
const Row = ({ account, text, amount, tone = "bank", note }: { account: string; text: ReactNode; amount: string; tone?: Tone; note?: string }) => (
  <div className={cn("rounded-md border px-2.5 py-1.5 text-xs", TONES[tone])}>
    <div className="flex justify-between gap-3"><span className="font-medium">{account}</span><span className="tabular-nums">{amount}</span></div>
    <div className="text-[11px] opacity-80">{text}</div>
    {note ? <div className="mt-0.5 font-mono text-[10.5px] opacity-70">{note}</div> : null}
  </div>
);

/** A sketch of the Terms & Schedule chart on a tracked loan. */
function ChartSketch() {
  return <figure className="my-3 max-w-[48.5rem] rounded-lg border bg-background p-3" aria-label="Sketch of the balance chart">
    <svg viewBox="0 0 420 150" className="w-full" role="img" aria-label="The loan balance falls to zero; Actual's balance steps down beside it until today; interest paid rises; the time before tracking is shaded">
      <rect x="30" y="10" width="40" height="115" fill="currentColor" opacity="0.06" />
      <text x="33" y="121" fontSize="8" fill="currentColor" opacity="0.6">Before tracking</text>
      <g stroke="currentColor" strokeOpacity="0.12"><line x1="30" x2="410" y1="30" y2="30" /><line x1="30" x2="410" y1="70" y2="70" /><line x1="30" x2="410" y1="110" y2="110" /></g>
      <path d="M30 18 L410 125" fill="none" stroke="#2563eb" strokeWidth="2.5" />
      <path d="M70 32 H100 V40 H130 V49 H160 V57 H190 V66 H220 V74 H245" fill="none" stroke="#16a34a" strokeWidth="1.5" strokeOpacity="0.8" />
      <path d="M30 124 Q150 80 410 52" fill="none" stroke="#ea580c" strokeWidth="1.5" strokeDasharray="3 3" />
      <line x1="245" x2="245" y1="10" y2="125" stroke="currentColor" strokeOpacity="0.5" strokeDasharray="3 3" />
      <text x="248" y="18" fontSize="9" fill="currentColor">Today</text>
      <circle cx="410" cy="125" r="3" fill="#2563eb" /><text x="378" y="118" fontSize="8" fill="currentColor">Paid off</text>
    </svg>
    <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span><b className="text-blue-600">━</b> Loan balance (the calculation)</span><span><b className="text-green-600">━</b> Balance in Actual (steps on payment dates)</span>
      <span><b className="text-orange-600">┅</b> Interest paid so far</span><span><b>┆</b> Today</span><span><b className="opacity-40">▮</b> Before tracking</span>
    </figcaption>
  </figure>;
}

/** Before and after one Apply: the payment becomes a split. */
function SplitPicture() {
  return <div className="my-3 grid max-w-[64.5rem] items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Before: one whole transfer</p>
      <Row account="Bank account" text="Transfer to Loan account" amount="−8,379.57" note="#2026-07 TRANSFER REPAY" />
      <div className="flex justify-center text-muted-foreground"><ArrowDown className="size-4" aria-hidden /></div>
      <Row account="Loan account" tone="loan" text="Transfer from Bank account · the debt goes down by all of it" amount="+8,379.57" />
    </div>
    <div className="flex flex-col items-center gap-1 text-muted-foreground"><ArrowRight className="size-5" aria-hidden /><span className="text-[11px]">Apply</span></div>
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">After: one split, two lines</p>
      <div className="rounded-md border p-2">
        <p className="mb-1.5 flex justify-between text-xs font-medium"><span>Bank account</span><span className="tabular-nums">−8,379.57</span></p>
        <div className="flex flex-col gap-1.5">
          <Row account="Principal" tone="principal" text="Transfer to Loan account" amount="−7,628.84" note="#2026-07 TRANSFER REPAY" />
          <Row account="Interest" tone="interest" text="Category: Bank Loan Interest" amount="−750.73" note="#2026-07 TRANSFER REPAY #interest" />
        </div>
      </div>
      <div className="flex justify-center text-muted-foreground"><ArrowDown className="size-4" aria-hidden /></div>
      <Row account="Loan account" tone="loan" text="Transfer from Bank account · the debt goes down by the principal only" amount="+7,628.84" />
    </div>
  </div>;
}

export function LoanGuide({ section, onSection, onClose, docsUrl }: { section: LoanGuideSection; onSection: (section: LoanGuideSection) => void; onClose: () => void; docsUrl?: string }) {
  const link = (to: LoanGuideSection, text: string) => <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSection(to)}>{text}</button>;
  return <GuideFrame title="Loans & Debt guide" description="Work out a loan, then keep it in step with Actual: each repayment split into principal and interest, with the history in one place." docsUrl={docsUrl} sections={LOAN_GUIDE_SECTIONS} icons={SECTION_ICONS} section={section} onSection={onSection} onClose={onClose}>
          {section === "start" && <>
            <Para>A loan in Bench can be two things. Until it is saved it is a <b>loan calculator</b>: change the amount, rate or term and see the repayment, the interest and the payoff date at once. Once it is saved and linked to its account in Actual, it is <b>tracked</b>: Bench lines each installment up with the payment you made, and splits it into principal and interest when you say so.</Para>
            <div className="grid max-w-[64.5rem] gap-3 sm:grid-cols-2">
              <Card tone="calc" icon={Calculator} title="A calculator, while it is not saved">Every figure updates as you type: repayment, total interest, payoff date, the chart and the full schedule. Try extra payments, rate changes or a shorter term. Nothing is stored and nothing reads or writes Actual. See {link("calculator", "Terms & Schedule")}.</Card>
              <Card tone="loan" icon={Link2} title="Tracked, once it is saved and linked">The loan reads its off-budget account in Actual. Repayments shows each installment and whether it is recorded; one Apply turns a whole payment into a principal and interest split. See {link("link", "Link to Actual")}.</Card>
            </div>
            <Heading>Your first tracked loan</Heading>
            <Steps items={[
              ["In Actual: the loan account", "Create an off-budget account for the loan, holding what you owe (a negative balance). The money received or an opening balance starts it."],
              ["Terms & Schedule", "Enter the contract: amount, rate, day count, term, start and first repayment date. The schedule should match your lender's."],
              ["Link to Actual", "Choose the loan account, how interest reaches Actual, and the first installment to track. Save."],
              ["Repayments", "Every installment from the tracking start, matched to your payments. Apply the ones marked Unrecorded."],
              ["Loan Ledger", "Every row of the loan account with what it is: the loan received, repayments, extra principal, draws."],
              ["Check now and then", "Refresh after you import from your bank. New payments appear as Unrecorded; apply them when you like."],
            ]} />
            <Callout title="Saving never writes to Actual">Saving stores the loan&apos;s terms and settings in Bench only. Actual changes only when you press Apply on a repayment, one confirmed write at a time. See {link("safety", "What Bench writes")}.</Callout>
          </>}

          {section === "calculator" && <>
            <Para>The left panel holds the contract; everything on the right is worked out from it. For a loan not saved yet this page is the whole calculator. For a tracked loan it also shows what really happened, from the Loan Ledger.</Para>
            <div className="grid max-w-[64.5rem] gap-2 sm:grid-cols-4">
              <Tile label="Monthly repayment" value="8,379.57" detail="Level payment" />
              <Tile label="Total repayments" value="401,978.64" detail="Over the whole loan" />
              <Tile tone="interest" label="Total interest" value="51,978.64" detail="Paid so far 48,284.91 · still to pay 3,693.73" />
              <Tile tone="principal" label="Payoff date" value="01 Oct 2027" detail="11 mos left" />
            </div>
            <Heading>The left panel</Heading>
            <Example caption="What each part sets" head={["Part", "What to enter"]} rows={[
              ["Loan", "Type, amount, years and months, and the start date (when the money was paid out)."],
              ["Interest rate", "The annual rate and the day count. Most loans use Actual/365 Fixed; see Calculation method."],
              ["Repayments", "How often, and optionally the contract's repayment, first repayment date and maturity date, when your contract states them."],
              ["Optional features", "Interest-only periods, a balloon payment, an offset account, and fees or other costs."],
            ]} />
            <Heading>The chart</Heading>
            <ChartSketch />
            <Para>The chart opens monthly for a loan of up to 10 years and yearly for a longer one; your choice is remembered. A tracked loan shows <b>Balance in Actual</b> as steps on payment dates, a <b>Today</b> line, and light shading for the time before tracking started.</Para>
            <Heading>The schedule</Heading>
            <Para>Every installment with its payment, principal, interest and balance. On a tracked loan, rows up to today say <b>From Actual</b>: they use what you really paid. <b>Jump to today</b> scrolls to now; Monthly, Yearly and All events change only how the rows are grouped.</Para>
            <Callout title="Compare with saved">On a saved loan, edits stay unsaved until Save changes. Tick <b>Compare with saved</b> to see the difference an edit makes before you keep it.</Callout>
          </>}

          {section === "events" && <>
            <Para>Events are things that change the loan between its regular repayments. Add them with the buttons above the Events list. They affect the calculation; adding an event does not create a transaction in Actual.</Para>
            <Heading>Choose an event</Heading>
            <Example caption="Event types and what you can set" head={["Event", "How it works"]} rows={[
              ["Extra payment", "Pay extra toward the loan or deposit into an enabled offset account. Set an amount and date; optionally repeat weekly, fortnightly, monthly, quarterly or annually through an end date."],
              ["Redraw / Withdraw", "Borrow more from the loan or withdraw from an enabled offset account. Set an amount and date; optionally repeat through an end date."],
              ["Fee", "Add a cost paid in cash or added to the loan. Set an amount and date; optionally repeat through an end date."],
              ["Rate change", "Set a new rate and start date, with optional repayment and rate limits. Each change is entered separately."],
              ["Repayment change", "Set a new scheduled repayment amount from a chosen date. Each change is entered separately."],
            ]} />
            <Example caption="Where events come from on a tracked loan" head={["Source", "What it is", "Can you switch it off?"]} rows={[
              ["From Actual", "Extra principal, draws and fees in the Loan Ledger: what really happened", "No: it happened. Change its type in the Loan Ledger"],
              ["What-if", "An event after today that you are trying out", "Yes, with its On switch, to compare with and without"],
              ["What-if (passed)", "A what-if whose date has gone by: the Loan Ledger now holds what happened", "It is shown but not projected; remove it when you like"],
              ["Contract", "A rate change that is part of the loan's terms", "Edit it in Rate changes"],
            ]} />
            <Heading>What each event saves</Heading>
            <Para>The <b>Saves</b> column shows the interest and time each event saves, worked out in date order: each one on top of the ones before it. So the rows add up exactly to the totals above the list.</Para>
            <Example caption="Two extra payments on the example loan" head={["Date", "Event", "Amount", "Saves"]} rows={[
              ["01 Jan 2027", "Extra payment", "10,000.00", <span key="a" className="text-green-700 dark:text-green-400">13,085.97 · 7 mo</span>],
              ["22 Jun 2027", "Extra payment", "16,000.00", <span key="b" className="text-green-700 dark:text-green-400">18,666.41 · 10 mo</span>],
              ["", "What-ifs total", "", <b key="c">31,752.38 · 1 yr 5 mo</b>],
            ]} />
            <Callout title="Repeating events and costs">A repeating extra payment is one row, credited with all its payments. A draw or a fee shows what it adds, in red. If your loan recalculates its repayment after an extra payment, the payoff date stays and the row shows the lower repayment instead.</Callout>
          </>}

          {section === "method" && <>
            <Para>Lenders work out interest in slightly different ways, and a small difference adds up over years. The defaults suit most loans: <b>daily interest</b>, a <b>level payment</b> and the <b>Actual/365 Fixed</b> day count. Set the day count beside the interest rate; everything else is under <b>Set calculation method</b>.</Para>
            <Example caption="Day counts" head={["Day count", "A year is", "Common for"]} rows={[
              ["Actual/365 Fixed", "365 days, every year", "Most mortgages and personal loans (the default)"],
              ["Actual/360", "360 days, so slightly more interest", "Some bank and Islamic finance products"],
              ["Actual/Actual (calendar year)", "365 or 366 days, by the year", "Some lenders, mostly outside the UAE"],
            ]} />
            <Heading>When your lender&apos;s figures differ</Heading>
            <Steps items={[
              ["Compare one installment", "Take a recent statement: the interest the lender charged for one month, and the balance after it."],
              ["Try the day count", "Switch between Actual/365 and Actual/360 and watch that installment's interest in the schedule."],
              ["Check the dates", "A first repayment date or business-day due dates (in Set calculation method) moves interest between months."],
              ["Still apart?", "Record a lender statement (⋯ menu → Check against lender statement) and let Bench continue from your lender's balance."],
            ]} />
            <Callout title="Rate changes">A rate change applies from its date; the repayment is recalculated by default, as most variable-rate loans do. In the rate change you can keep the repayment instead, so the loan runs longer or shorter.</Callout>
            <Para>For each calculation setting and its choices, see {link("settings", "Settings")}.</Para>
          </>}

          {section === "link" && <>
            <Para>Link to Actual connects the calculation to the loan&apos;s account in Actual. Create that account in Actual first: it must be <b>off budget</b>, and hold only this loan.</Para>
            <Steps items={[
              ["Loan and its account", "The name, the kind of loan and the off-budget account. If the loan has an offset account, choose that account too."],
              ["Repayments", "Transfers into the loan account count by themselves. If you record repayments as an expense in a bank account instead, add a payment rule that finds them (up to 10 rules)."],
              ["Interest", "Split each repayment (the usual choice), or, when your lender's own interest rows arrive in the loan account, Lender charges interest. Choose the interest category, the loan payment category, and what to add to each line's Notes (#interest by default)."],
              ["Tracking start", "The first installment Bench tracks, by installment number or due date. Earlier ones count as paid as contracted."],
              ["Opening position", "The balance owed at the tracking start: from the calculation, or from a lender statement."],
              ["Advanced", "Ignore differences up to (rounding, 1.00 by default), and Mark missing after (5 days late by default)."],
            ]} />
            <Heading>Where to start tracking</Heading>
            <div className="grid max-w-[64.5rem] gap-3 sm:grid-cols-2">
              <Card tone="loan" icon={Landmark} title="The account holds the whole loan">It starts with the money received, then every repayment. Start at installment 1. Bench suggests it.</Card>
              <Card tone="bank" icon={Wallet} title="The account starts later">It starts with an opening balance part-way through. Start at the first installment after it; Bench suggests that one, and you can use a lender statement for the balance.</Card>
            </div>
            <Para>Bench compares the opening position with Actual&apos;s loan account just before that installment. If they differ by more than the tolerance, Repayments starts with one <b>Opening adjustment</b> you can apply or skip. With a lender statement, one sentence also says how far ahead of (or behind) the original schedule you were.</Para>
            <Callout tone="warn" title="Only loans you owe, with a schedule">Tracking in Actual is for term loans you owe. A line of credit or a loan you made to someone else stays a calculation in Terms &amp; Schedule.</Callout>
          </>}

          {section === "repayments" && <>
            <Para>Every installment from the tracking start, matched to the payment that paid it, with what Bench would write. The newest is on top; the next one due is shown as Upcoming.</Para>
            <Example caption="Statuses" head={["Status", "Means", "What to do"]} rows={[
              [<StatusBadge key="r" status="recorded" />, "Actual already holds this installment as principal and interest", "Nothing"],
              [<StatusBadge key="u" status="unrecorded" />, "Paid, but still one whole payment in Actual", "Apply: one write splits it"],
              [<StatusBadge key="c" status="check" />, "Something needs a look: two payments could be it, a short payment, Actual's balance has parted from the calculation", "Open it (Review) and choose"],
              [<StatusBadge key="m" status="missing" />, "Due more than the number of days in Mark missing after (Link to Actual, Advanced) ago, and no payment found", "Pay it, or choose the payment if Bench missed it"],
              [<StatusBadge key="p" status="upcoming" />, "Not due yet", "Nothing"],
            ]} />
            <Heading>The figures above the list</Heading>
            <div className="grid max-w-[64.5rem] gap-2 sm:grid-cols-4">
              <Tile tone="loan" label="Owed in Actual" value="109,738.24" detail="Loan account today" />
              <Tile tone="calc" label="Bench expects" value="104,879.45" detail="By today · differs by 4,858.79 · 33 to apply" />
              <Tile label="Next payment" value="8,379.57" detail="Due 02 Nov 2026 · installment 36" />
              <Tile tone="interest" label="To do" value="33 Unrecorded" detail="0 Check · 0 Missing" />
            </div>
            <Para>While installments are Unrecorded, Actual&apos;s loan account still includes their interest, so it is higher than Bench expects. Applying them closes the gap.</Para>
            <Heading>Working through the list</Heading>
            <Steps items={[
              ["One at a time", "Press Apply on a row, or open it to see the split first and change it."],
              ["Many at once", "Tick rows (or Space) and apply the selection, or Apply all Unrecorded. They run in date order and stop at the first that doesn't apply."],
              ["The details panel", <>Click a row or press <Key>Enter</Key>. Step with ‹ › or <Key>↑</Key> <Key>↓</Key>; <Key>A</Key> applies, <Key>Esc</Key> closes.</>],
              ["Not this payment", "From a row's ⋯ menu, when Bench matched a payment that isn't this loan's. It is ignored from then on."],
            ]} />
            <Callout tone="warn" title="A write that may not have finished">If the connection drops during an Apply, a red banner names the installment and stops further writes. Check that payment in Actual, then press <b>The change is in Actual</b> or <b>It isn&apos;t</b>.</Callout>
          </>}

          {section === "split" && <>
            <Para>A repayment pays two things: interest, which is a cost, and principal, which lowers the debt. Recorded as one transfer, the whole payment lowers the debt in Actual and the interest never shows in your budget. Apply splits it, in place:</Para>
            <SplitPicture />
            <Example caption="What changes, and what doesn't" head={["", "Before", "After Apply"]} rows={[
              ["Bank account total", "−8,379.57", "−8,379.57 (unchanged)"],
              ["Interest in your budget", "None", "750.73 in the interest category"],
              ["Loan account", "Down by 8,379.57", "Down by 7,628.84, the principal only"],
              ["Date, payee, cleared", "", "Kept as they were"],
            ]} />
            <Heading>Before you apply</Heading>
            <Para>The details panel shows the split Bench calculated. Change the principal and the interest follows; Bench&apos;s own figure stays beside it. Each line has its own Notes: the payment&apos;s Notes, with <Tag>#interest</Tag> added to the interest line (you set the text in Link to Actual).</Para>
            <Callout title="Undo and edit">A split Bench made can be undone from its panel: the payment goes back to exactly what it was. <b>Edit split</b> changes the amounts of a split already in Actual. Both are one write, like Apply.</Callout>
          </>}

          {section === "ledger" && <>
            <Para>The Loan Ledger is the loan account in Actual, row for row, with what each row is. Its balance is the debt Actual shows. It is where the history comes from: the calculation in Terms &amp; Schedule follows it up to today.</Para>
            <Example caption="Types" head={["Type", "What it is", "Effect on the calculation"]} rows={[
              ["Loan received", "The money paid out at the start", "The opening balance"],
              ["Opening balance", "A starting balance part-way through the loan", "The opening balance"],
              ["Repayment", "The loan side of an installment (the whole payment until it is split)", "Pays an installment"],
              ["Extra principal", "Money paid in on top of the installments", "Lowers the balance from its date (an event From Actual)"],
              ["Draw", "Money taken out again, such as a redraw or top-up", "Raises the balance"],
              ["Fee", "A charge added to the loan", "Raises the balance"],
              ["Interest charged", "The lender's own interest row (Lender charges interest)", "Paid by the repayments"],
              ["Adjustment", "A correction, such as the opening adjustment", "Sets the balance right"],
              ["Unclassified", "Bench can't tell", "Left out until you choose a type"],
            ]} />
            <Para>A type in <i>italics, suggested</i> is Bench&apos;s guess; choose one to confirm it. Types are saved in Bench only. <b>Add entry</b> adds an adjustment row or records a lender statement. The pencil edits a row&apos;s Notes, which is written to Actual.</Para>
            <Callout tone="warn" title="Unclassified rows">An unclassified row that adds to the debt is left out of the calculation, so Bench and Actual drift apart. If it was a top-up, make it a Draw; if it was a correction, an Adjustment.</Callout>
          </>}

          {section === "assets" && <>
            <Para>Linked Assets shows the assets this loan financed, such as a home or a car, with your share of the loan for each. Links are made from the asset, in Assets → Linked Loans; Bench then shows the asset&apos;s value, your allocated debt and your equity side by side.</Para>
            <div className="grid max-w-[64.5rem] gap-2 sm:grid-cols-3"><Tile label="Recorded value" value="252,000.00" detail="From the asset's account" /><Tile tone="loan" label="Debt allocated" value="109,738.24" detail="Your share of this loan" /><Tile tone="principal" label="Equity" value="142,261.76" detail="Value − allocated debt" /></div>
          </>}

          {section === "scenarios" && <>
            <Para>What Bench does in the situations people meet most, and what you do.</Para>
            <Example caption="Situations" head={["Situation", "What Bench does", "What you do"]} rows={[
              ["Paid a few days early", "Matches it to that installment; interest is worked out to the day it was paid", "Apply as usual"],
              ["Paid late", "Missing after the Mark missing days; matched as soon as the payment appears", "Refresh after it lands, then Apply"],
              ["Paid a little more or less", "Splits what was paid; a payment short of the interest is a Check", "Review the Check"],
              ["Paid extra on top", "A separate transfer into the loan account is Extra principal; the calculation follows", "Nothing, or change its type"],
              ["Repayments are an expense, not a transfer", "Finds them with a payment rule; Apply makes them a split with the principal as a transfer", "Add a payment rule in Link to Actual"],
              ["Started tracking part-way", "Counts earlier installments as paid; one opening adjustment if Actual differs", "Choose the first installment; use a lender statement if you have one"],
              ["Bench's balance differs from the lender's", "A Check where they part", "Set the day count or method, Accept Actual, or Adjust to Bench"],
              ["The rate changed", "Nothing until you add it", "Add a Rate change in Terms & Schedule"],
              ["Topped up or redrew", "A transfer out of the loan account is a Draw", "Confirm its type in the Loan Ledger"],
              ["Wrong payment matched", "", "Not this payment, from the row's ⋯ menu"],
            ]} />
          </>}

          {section === "safety" && <>
            <div className="grid max-w-[64.5rem] gap-3 sm:grid-cols-3">
              <Card tone="calc" icon={ShieldCheck} title="Nothing automatic">Bench writes only when you press Apply, Undo split, Edit split or Save Notes. Saving the loan never writes to Actual.</Card>
              <Card tone="bank" icon={ListChecks} title="One write at a time">Each Apply is recorded in Bench first, written, then checked against Actual. If the check fails, nothing else runs.</Card>
              <Card tone="loan" icon={Scale} title="Actual is the truth">Bench reads the loan account each time. If you change or delete a transaction in Actual, Bench follows on the next Refresh.</Card>
            </div>
            <Example caption="What each action changes in Actual" head={["Action", "In Actual"]} rows={[
              ["Apply (a split)", "The payment becomes a split: principal transfer + interest line. The loan-side row follows the principal"],
              ["Apply (opening adjustment)", "One row in the loan account, Notes \"Opening adjustment\""],
              ["Undo split", "The payment goes back to exactly what it was before"],
              ["Edit split", "The split's line amounts change; every line keeps its id"],
              ["Save Notes (Loan Ledger)", "That transaction's Notes"],
              ["Save, types, payment rules, lender statements", "Nothing: saved in Bench only"],
            ]} />
            <Callout title="Reconciled transactions">Bench never changes a reconciled transaction. Unlock it in Actual first if it needs to be split.</Callout>
          </>}

          {section === "settings" && <LoanSettingsGuide />}

          {section === "glossary" && <Example caption="Terms" head={["Term", "Meaning"]} rows={[
            ["Installment", "One scheduled repayment, numbered from the start of the loan."],
            ["Tracking start", "The first installment Bench matches to payments; earlier ones count as paid."],
            ["Opening position", "What is owed just before the tracking start: from the calculation or a lender statement."],
            ["Opening adjustment", "One row that brings Actual's loan account to the opening position."],
            ["Split", "A payment in Actual divided into a principal transfer and an interest line."],
            ["Principal", "The part of a payment that lowers the debt."],
            ["Interest", "The part that is the cost of borrowing; it goes to your interest category."],
            ["Bench expects", "The balance the calculation says you should owe today."],
            ["Day count", "How a year is counted for daily interest: 365 days, 360 days, or the actual year."],
            ["What-if", "An event after today you are trying out; switch it off to compare."],
            ["Payment rule", "Conditions that find repayments recorded as an expense, not a transfer."],
            ["Off budget", "An account Actual keeps outside your budget, as loan accounts are."],
          ]} />}
  </GuideFrame>;
}
