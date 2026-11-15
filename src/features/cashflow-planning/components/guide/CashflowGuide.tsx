"use client";

import { BookOpen, Grid3x3, Keyboard, Link2, Save, Target, type LucideIcon } from "lucide-react";
import { GuideFrame } from "@/components/ui/guide-frame";
import { Example, Heading, Para, Steps } from "@/components/ui/guide-primitives";
import { Callout, Card } from "@/features/financial-insights/components/guide/guideVisuals";
import { GridSketch, LayoutSketch, ShortcutGroups } from "./cashflowGuideVisuals";

/** The Cashflow Planning guide: what a plan is, how to read the grid, what rows follow, how to work in it, and how plans are kept. */
export type CashflowGuideSection = "start" | "reading" | "rows" | "working" | "answers" | "plans";

export const CASHFLOW_GUIDE_SECTIONS: [CashflowGuideSection, string][] = [
  ["start", "Start here"], ["reading", "Reading the grid"], ["rows", "Rows and forecasts"], ["working", "Working in the grid"], ["answers", "Answers, goals and summaries"], ["plans", "Plans, saving and settings"],
];

const SECTION_ICONS: Record<CashflowGuideSection, LucideIcon> = { start: BookOpen, reading: Grid3x3, rows: Link2, working: Keyboard, answers: Target, plans: Save };

const Grid = ({ cols = 3, children }: { cols?: 2 | 3; children: React.ReactNode }) => <div className={`grid max-w-[55rem] gap-3 ${cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>{children}</div>;

export function CashflowGuide({ section, onSection, onClose, docsUrl }: { section: CashflowGuideSection; onSection: (section: CashflowGuideSection) => void; onClose: () => void; docsUrl?: string }) {
  const link = (to: CashflowGuideSection, text: string) => <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSection(to)}>{text}</button>;
  return (
    <GuideFrame title="Cashflow Planning guide" description="How to read, build and work in a cash plan laid over what Actual recorded." docsUrl={docsUrl}
      sections={CASHFLOW_GUIDE_SECTIONS} icons={SECTION_ICONS} section={section} onSection={onSection} onClose={onClose}>

      {section === "start" && <>
        <Para>A cash plan shows where your money stands at the end of every month, years ahead. The past is <b>what Actual recorded</b>, read straight from your budget. The future is <b>what you expect</b>, built from rows you control. It replaces the long-range spreadsheet many people keep next to their budget.</Para>
        <LayoutSketch />
        <Heading>Get going in three steps</Heading>
        <Steps items={[
          ["Create a plan", "Start from your Actual data (a row for everything that moved cash in the last 12 months), from an empty plan, or as a plain worksheet that does not use Actual at all."],
          ["Set what each row follows", <>A row follows categories, category groups or accounts in Actual, and has its own forecast: a typed amount, an average, the budget, a schedule or a loan. See {link("rows", "Rows and forecasts")}.</>],
          ["Read the answers", "The key figures say how low your cash gets and when, whether it stays above your minimum, and whether you reach your goals. Click any month to see what it is made of."],
        ]} />
        <Grid>
          <Card icon={Grid3x3} tone="value" title="One grid, past and future">Past months are recorded figures; this month is what was recorded so far plus what is still expected; later months are the forecast. See {link("reading", "Reading the grid")}.</Card>
          <Card icon={Link2} tone="income" title="Nothing left out">What no row follows still shows, as <b>Not in plan</b>, so every month adds up to the real change in your cash.</Card>
          <Card icon={Save} tone="kept" title="Saved as you type">Each change is saved a moment later, and a plan changed in another tab is never overwritten silently. See {link("plans", "Plans, saving and settings")}.</Card>
        </Grid>
        <Callout title="Actual is only ever read">Cashflow Planning never writes to Actual and never touches the Save of the other pages. Plans live in Actual Bench’s own database, against your budget’s accounts, categories and schedules.</Callout>
      </>}

      {section === "reading" && <>
        <Para>Every month is a column, and every calendar year ends with a <b>Total</b> column. The columns tell you at a glance what is a fact and what is a guess.</Para>
        <GridSketch />
        <Grid cols={2}>
          <Card icon={Grid3x3} tone="value" title="Past months: recorded, in ink">Figures Actual recorded are in a dark ink blue on a light grey fill, as if written in ink: you cannot change them here. Balances chain from the real balance of the plan’s cash accounts, so the forecast always starts from today.</Card>
          <Card icon={Grid3x3} tone="warn" title="This month: both">The current month, in amber, shows what was recorded so far plus what is still expected. The calendar button in the plan bar scrolls back to it.</Card>
          <Card icon={Grid3x3} tone="neutral" title="The forecast: black, on white">Coming months are black. The cells you can type in are plain white; a small corner mark shows a typed amount, which always wins over the forecast.</Card>
          <Card icon={Grid3x3} tone="kept" title="Years">Each year’s <b>Total</b> sums the flows and shows the balance at the year’s end. <b>Years</b> in the plan bar shows one column per year, for the long view. Hide the Total columns between the months with <b>Year totals</b> under View.</Card>
        </Grid>
        <Heading>Sections, groups and rows</Heading>
        <Example caption="What each line is" head={["Line", "What it is"]} rows={[
          ["Section (INCOME, EXPENSES, SAVINGS & INVESTMENTS, LOANS & DEBT)", "A band that adds up everything under it. Collapse it to see only the total."],
          ["Group", "A subtotal you create, tinted and bold. It adds up its rows and is not typed into."],
          ["Row", "One thing you plan, on a white background in the forecast. This is where you type amounts."],
          ["Not in plan", "What Actual recorded that no row follows. It keeps the months adding up, and its details can turn each item into a row."],
          ["Net cashflow, Closing balance", "Pinned under the grid so they stay in view while you scroll."],
        ]} />
        <Callout title="Amounts are positive in their section’s direction">An expense of 500 is typed as 500. A negative amount is the reverse: a refund in Expenses, a withdrawal in Savings, new borrowing in Loans & debt.</Callout>
        <Heading>Past months, three ways</Heading>
        <Para>The <b>Past months</b> switch in the plan bar, beside Months and Years, lets past months show <b>Actual</b> (what was recorded), <b>Planned</b> (what the plan said), or the <b>Difference</b>, where better and worse than planned are coloured and signed. A past month’s plan is known only if you typed it or set it to repeat.</Para>
        <Callout tone="warn" title="Why past months cannot be typed into">A past month is a fact in Actual, and editing it would make the plan disagree with the real balances. To change what happened, change it in Actual and press <b>Refresh</b>.</Callout>
      </>}

      {section === "rows" && <>
        <Para>A row has two halves: what it <b>follows</b> in Actual, which fills the past months, and where its <b>forecast</b> comes from, which fills the coming ones. Select a row to see and change both in the details panel.</Para>
        <Heading>What a row follows in Actual</Heading>
        <Grid>
          <Card icon={Link2} tone="income" title="Categories and category groups">A whole category group, or chosen categories, such as Groceries or all of Living.</Card>
          <Card icon={Link2} tone="value" title="Accounts">The transfers between your cash and an account outside it (a broker, a mortgage), or the uncategorized entries of a cash account, optionally money in only or money out only.</Card>
          <Card icon={Link2} tone="kept" title="Each movement counted once">A transfer follows its account before its category, and no movement is placed twice. Anything left over shows as Not in plan.</Card>
        </Grid>
        <Heading>Where the forecast comes from</Heading>
        <Example caption="The coming months of a row" head={["Source", "What the coming months use"]} rows={[
          ["Typed amounts", "A number you type into a month. It always wins and is marked with a corner."],
          ["A repeating amount", "An amount every 1 to 24 months, with a start, an optional end and a yearly change."],
          ["Average", "The average of the last 3, 6, 12 or 24 complete months, with an optional yearly change."],
          ["Budget", "Actual’s budget for the followed categories. Months past the last budgeted one repeat it. Set Paid to the month after for a credit card paid after its statement."],
          ["Schedule", "The upcoming dates and amounts of Actual schedules."],
          ["Loan", "The repayments the Loans page projects for a tracked loan."],
        ]} />
        <Heading>Loan repayments</Heading>
        <Para>A row that follows a tracked loan counts the <b>whole repayment</b> by default: each instalment is forecast whole, and the interest and fee lines of repayments already recorded as splits count in the loan row instead of in their category, so nothing is counted twice. Choose <b>Principal only</b> to keep the interest with its category. Money that arrives from a loan account is borrowing: it shows under Income and is never netted against repayments.</Para>
        <Heading>Putting a transaction in another month</Heading>
        <Para>A transaction in a cash account counts in another month when its Actual note carries a <b>#YYYY-MM</b> tag, or when you move it to the month before or after in the plan’s transaction list (“Counted in”; saved in the plan, Actual is not changed). A <b>Moved between months</b> line puts the amount back in the month the money really moved, so the balances stay the real ones, and moved cells are marked.</Para>
        <Heading>A card paid the month after</Heading>
        <Para>A card is usually paid after its statement, so this month’s payment is last month’s spending. On a row that follows the budget, set <b>Paid</b> to <b>The month after</b> (or two months after). A month then shows what the credit cards recorded for the followed categories the month before, once that month is over; for the month in progress, the larger of what was spent so far and its budget; and the budget for months still to come. Use it for the row that stands for the card’s repayment, and keep the cash rows of the same categories at zero so nothing is counted twice.</Para>
        <Heading>When two rows follow the same thing</Heading>
        <Para>Recorded history goes to the first row, in plan order, that follows a category, group or account, so a later row that follows it too shows none of it in past months. It can still use it for its forecast. The row shows a quiet note, with a link to the row that holds it. It becomes a warning only when both rows forecast it, which would count it twice, or when the later row averages history it does not have.</Para>
        <Callout title="See what is behind a figure">Right-click a past month on a row, a group, a section, a Not in plan line, Transfers in transit or Moved between months, or click an amount in the details panel, to list the transactions that make it up.</Callout>
      </>}

      {section === "working" && <>
        <Para>The grid works like a spreadsheet. Click a cell, or Tab into the grid, and use the keyboard. Only forecast cells of a row can be typed into; a typed amount always wins over the forecast.</Para>
        <ShortcutGroups />
        <Heading>With the mouse</Heading>
        <Grid>
          <Card icon={Keyboard} tone="value" title="Select and extend">Click a cell, or drag across several. Shift-click extends the selection; drag the small square at the corner to fill to the right.</Card>
          <Card icon={Keyboard} tone="income" title="Open a summary">Click a month (or a year’s Total) in the header to see its summary in the details panel. The keyboard way is S on a cell.</Card>
          <Card icon={Keyboard} tone="warn" title="Rows and groups">Double-click a name to rename it; drag a label onto another row, a group or a section to move it; right-click for the full menu.</Card>
        </Grid>
        <Heading>Finding your way</Heading>
        <Para>The search box above the labels filters rows by name. <b>Expand all</b> and <b>Collapse all</b> sit beside it. The grid opens on the current month, the calendar button in the plan bar returns to it, and the key figures at the top open their month in the grid.</Para>
        <Callout title="Undo is per plan">{"Ctrl/⌘ + Z and Ctrl/⌘ + Y undo and redo changes to the plan you are in. Undo only changes the working copy; the next save stores the result."}</Callout>
      </>}

      {section === "answers" && <>
        <Para>The strip above the grid answers what the plan exists for. Click a figure to see its month in the grid.</Para>
        <Grid>
          <Card icon={Target} tone="value" title="Cash today">The balance of the plan’s cash accounts now. The forecast starts from here.</Card>
          <Card icon={Target} tone="warn" title="Lowest point, next 12 months">How low your cash gets, and at the end of which month.</Card>
          <Card icon={Target} tone="spend" title="Minimum cash">An emergency-fund floor you set in Plan settings. The strip shows the first month it is crossed, or that it never is.</Card>
          <Card icon={Target} tone="income" title="End of the year and of the plan">The forecast closing balance on 31 December and in the plan’s last month.</Card>
          <Card icon={Target} tone="kept" title="Next 12 months, net">What the next twelve whole months add or take, and the monthly average.</Card>
          <Card icon={Target} tone="neutral" title="A plan that has ended">If every month of a plan is in the past, nothing is looked ahead over and the strip says so.</Card>
        </Grid>
        <Heading>Goals and savings</Heading>
        <Para>A <b>goal</b> is an amount of cash, or of cash plus savings, to reach by a month. The plan shows whether the forecast gets there and how much more a month it would take. The <b>savings estimate</b> starts from the balance of your savings accounts, adds what the plan puts aside each month, and can grow at an expected yearly rate.</Para>
        <Heading>The month summary</Heading>
        <Para>Click a month, or a year’s Total, to see it in the details panel: the closing balance and its change, where the cash went (income, expenses, savings, debt and other movements, with the transactions behind each), the biggest lines of every section, a Cash or Cash + savings switch, and any minimum-cash or goal alerts.</Para>
        <Callout title="The chart">A chart under the key figures draws the balance over the whole plan: recorded solid, forecast dashed, with the minimum, your goals and, when there are savings accounts, cash plus savings. Hide it under View.</Callout>
      </>}

      {section === "plans" && <>
        <Heading>Saving</Heading>
        <Para>Every edit is saved a moment later, and the plan bar says <b>Saved</b>, <b>Saving</b> or <b>Not saved</b>. If a save fails, use Retry. If the plan was changed in another tab or device since you opened it, nothing is overwritten silently: you choose between <b>Load the other version</b> and <b>Keep mine and overwrite</b>. A plan deleted elsewhere offers the same choice, and keeping yours puts it back.</Para>
        <Callout title="Leaving the page">Edits are sent before you leave. If the browser asks whether to leave, something has not been saved yet; stay a moment and check the plan bar.</Callout>
        <Heading>Creating plans</Heading>
        <Grid>
          <Card icon={Save} tone="income" title="From Actual">A row for everything that moved cash in the last 12 months, by category group or by category. The quickest start.</Card>
          <Card icon={Save} tone="value" title="Empty">Add the rows yourself and say what each follows. Good when you know what you want.</Card>
          <Card icon={Save} tone="kept" title="A plain worksheet">Does not use Actual: you type an opening balance and every amount.</Card>
        </Grid>
        <Para>When the budget has credit cards, you choose whether to count card spending when it happens (cards are cash) or card payments only (cards are outside the plan, each with a payments row).</Para>
        <Heading>Plan settings</Heading>
        <Example caption="What you can set" head={["Setting", "What it does"]} rows={[
          ["First month and years", "The plan’s length, from 1 to 50 years. Shortening it removes typed amounts and goals outside the new months; Undo brings them back."],
          ["Minimum cash", "The floor the key figures and the balance row warn about."],
          ["Accounts", "Per plan, each account is cash, savings or outside. By default Cash and Bank accounts and credit cards are cash, fixed deposits, investments and retirement accounts are savings, and everything else is outside. Classes come from the Accounts page."],
          ["Goals and savings growth", "The targets and the expected yearly growth the answers use."],
        ]} />
        <Heading>Plan menu</Heading>
        <Para>The <b>…</b> menu starts a new plan, duplicates the plan, exports it as JSON, imports one, exports the figures as CSV, and deletes the plan. Export a plan first if you may want it back: deleting removes it for good, and nothing in Actual changes. <b>Refresh</b> reads Actual again to pick up changes made elsewhere.</Para>
      </>}
    </GuideFrame>
  );
}
