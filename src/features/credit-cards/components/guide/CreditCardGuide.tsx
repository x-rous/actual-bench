"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { ArrowLeftRight, BookOpen, CalendarDays, CircleHelp, CreditCard, FileText, Keyboard as KeyboardIcon, Receipt, Layers, type LucideIcon } from "lucide-react";
import { GuideFrame } from "@/components/ui/guide-frame";
import { Example, Heading, Para, Steps } from "@/components/ui/guide-primitives";
export { Example, Heading, Para, Steps } from "@/components/ui/guide-primitives";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import { GLOSSARY, INSTALMENT_PLANS_DESCRIPTION, type GuideSection } from "../../lib/vocabulary";
import { StatusBadge } from "../primitives/StatusBadge";

/**
 * The Credit cards guide (one dialog for the workflow, the concepts and the glossary), laid out like the
 * ActualQL reference: a section menu, scrolling content, small headings and worked examples. Every screen
 * opens it on its own section; links elsewhere (card editor, plan editor, found plans) open a section too.
 */

const SECTIONS: [GuideSection, string][] = [
  ["start", "Getting started"],
  ["monthly", "Each month"],
  ["statements", "Statements & review"],
  ["bills", "Bills & payments"],
  ["types", "Transaction types"],
  ["plans", "Instalment plans"],
  ["figures", "Card figures"],
  ["keyboard", "Keyboard"],
  ["glossary", "Glossary"],
];

type GuideApi = { open: (section?: GuideSection) => void };
const GuideContext = createContext<GuideApi | null>(null);

/** Provides `useGuide` to the workspace and renders the dialog once. */
export function GuideProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<GuideSection | null>(null);
  return <GuideContext.Provider value={{ open: (next = "start") => setSection(next) }}>
    {children}
    {section && <CreditCardGuide section={section} onSection={setSection} onClose={() => setSection(null)} />}
  </GuideContext.Provider>;
}

export const useGuide = () => useContext(GuideContext);

/** A link that opens the guide on a section; renders nothing outside the workspace (e.g. isolated tests). */
export function GuideLink({ section, children, className }: { section: GuideSection; children: ReactNode; className?: string }) {
  const guide = useGuide();
  if (!guide) return null;
  return <button type="button" onClick={() => guide.open(section)}
    className={cn("inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline", className)}>
    <CircleHelp className="size-3.5" aria-hidden />{children}
  </button>;
}

const SECTION_ICONS: Record<GuideSection, LucideIcon> = {
  start: BookOpen, monthly: CalendarDays, statements: FileText, bills: Receipt, types: ArrowLeftRight,
  plans: Layers, figures: CreditCard, keyboard: KeyboardIcon, glossary: CircleHelp,
};

export function CreditCardGuide({ section, onSection, onClose }: { section: GuideSection; onSection: (section: GuideSection) => void; onClose: () => void }) {
  return <GuideFrame title="Credit cards guide" description="How the workflow fits together, what every figure means, and how to record instalment plans." sections={SECTIONS} icons={SECTION_ICONS} section={section} onSection={onSection} onClose={onClose}>
          {section === "start" && <Start onSection={onSection} />}
          {section === "monthly" && <Monthly />}
          {section === "statements" && <Statements />}
          {section === "bills" && <Bills />}
          {section === "types" && <Types />}
          {section === "plans" && <Plans />}
          {section === "figures" && <Figures />}
          {section === "keyboard" && <Keyboard />}
          {section === "glossary" && <Glossary onSection={onSection} />}
  </GuideFrame>;
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function Box({ label, value, tone }: { label: string; value: string; tone?: "result" | "bank" }) {
  return <div className={cn("min-w-28 rounded-md border px-3 py-2 text-center", tone === "result" && "border-foreground", tone === "bank" && "bg-muted/50")}>
    <div className="text-[11px] text-muted-foreground">{label}</div>
    <div className="text-sm font-semibold tabular-nums">{value}</div>
  </div>;
}

const Op = ({ children }: { children: ReactNode }) => <span className="text-sm font-semibold text-muted-foreground" aria-hidden>{children}</span>;

export const Tag = ({ children }: { children: ReactNode }) => <code className="rounded bg-muted/70 px-1 font-mono text-[11px]">{children}</code>;
export const Key = ({ children }: { children: ReactNode }) => <kbd className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]">{children}</kbd>;

// ─── Sections ────────────────────────────────────────────────────────────────

function Start({ onSection }: { onSection: (section: GuideSection) => void }) {
  const link = (section: GuideSection, text: string) => <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSection(section)}>{text}</button>;
  return <>
    <Para>
      Credit cards reads each card&apos;s transactions and balance from Actual and checks them against your bank statements, so you always know
      what the next bill is, what is left to pay and what the card really owes. Card settings, statements, your review answers and instalment
      plans are saved in Actual Bench when you select Save; Actual itself is never changed.
    </Para>
    <Heading>The workflow</Heading>
    <Steps items={[
      ["Register the card", <>In Accounts, mark the Actual account as Credit Card, then Add card: limit, APR, closing day and due rule.</>],
      ["Add the first statement", <>Pick the statement you want to start from and enter its figures. Bench fills in what it can from Actual (amber dots).</>],
      ["Review it", <>Answer On this statement or Not for each transaction until the statement shows Matches bank. {link("statements", "How review works")}</>],
      ["Add instalment plans", <>Balance transfers, instalment purchases and quick cash. Plans in a plan account are found for you. {link("plans", "Instalment plans")}</>],
      ["Each month", <>Add the new statement, review it, pay, and check the card&apos;s Overview. {link("monthly", "The monthly routine")}</>],
      ["Read the figures", <>Total owed, Left to pay and Available credit are explained in {link("figures", "Card figures")}.</>],
    ]} />
    <Heading>Where things are</Heading>
    <Example caption="Screens" head={["Screen", "What it answers"]} rows={[
      ["All cards", "Every card at a glance: next payment, what is left to pay, Total owed, credit used and what needs attention."],
      ["Overview", "One card: what needs you, the next payment, Total owed and the balance over time."],
      ["Statements", "Each bank statement with the bank's figures, this bill's payments and whether it matches the bank."],
      ["Payments", "Every payment and which bill it paid, and whether it was on time."],
      ["Activity", "Every card transaction with its type, statement and plan."],
      ["Instalment Plans", "Each plan's balance, schedule and transactions."],
      ["Insights", "Interest and fees over time, and your payment track record."],
    ]} />
  </>;
}

function Monthly() {
  return <>
    <Para>When a new statement arrives from the bank, four steps keep everything current. Overview lists anything that still needs you.</Para>
    <Steps items={[
      ["Add the statement", "Statements › Add statement. Dates and balances are pre-filled from Actual; check each amber value against the statement."],
      ["Review its transactions", "Answer each one, or select several and answer them together. Save when the statement shows Matches bank."],
      ["Pay the bill", "Pay from your bank. Once the payment is in Actual, Bench assigns it to the bill and shows Paid in full, Minimum paid or Pending."],
      ["Check Overview", "Needs your attention lists overdue bills, statements to check or enter, and plans to look at."],
    ]} />
    <Heading>Statements you have not entered</Heading>
    <Para>
      Between statements, Bench estimates the next one from the card&apos;s billing days, shown as <StatusBadge label="Estimate" tone="muted" />.
      Use Verify to enter the bank&apos;s figures once the statement is out.
    </Para>
  </>;
}

function Statements() {
  return <>
    <Para>
      A statement review checks that the transactions you put on a statement add up to the balance the bank printed. Each transaction gets one
      answer; the strip at the top shows the result.
    </Para>
    <Heading>The statement check</Heading>
    <div role="img" aria-label="Previous balance minus payments and credits, plus charges, plus interest and fees, equals the statement balance; compared with the bank's balance"
      className="mb-3 flex flex-wrap items-center gap-2">
      <Box label="Previous" value="1,200.00" /><Op>−</Op><Box label="Payments & credits" value="1,200.00" /><Op>+</Op><Box label="Charges" value="800.00" />
      <Op>+</Op><Box label="Interest & fees" value="20.00" /><Op>=</Op><Box label="Your statement" value="820.00" tone="result" />
      <Op>vs</Op><Box label="Bank" value="820.00" tone="bank" /><StatusBadge label="Matches bank" tone="success" />
    </div>
    <Para>
      When the two differ the strip shows <StatusBadge label="Difference" tone="attention" /> with the amount. Usually a transaction is on the wrong
      statement (it posted after the closing date) or is still pending at the bank.
    </Para>
    <Heading>Your answers</Heading>
    <Example caption="For each transaction in the statement's window" head={["Answer", "Key", "Meaning"]} rows={[
      ["On this statement", <Key key="y">Y</Key>, "The bank printed it on this statement."],
      ["Not on this statement", <Key key="n">N</Key>, "It belongs to the previous or next statement."],
      ["Unsure", <Key key="q">?</Key>, "Decide later; the statement stays To review."],
    ]} />
    <Para>Move sends a transaction to another statement, for example when it posted a day after the closing date.</Para>
    <Heading>Statement states</Heading>
    <Example caption="The bank match" head={["Badge", "Meaning"]} rows={[
      [<StatusBadge key="m" label="Matches bank" tone="success" />, "Every transaction is answered and they add up to the bank's balance."],
      [<StatusBadge key="r" label="To review" tone="attention" />, "Some transactions are not answered yet."],
      [<StatusBadge key="d" label="Difference" tone="attention" />, "Everything is answered but the total is off."],
      [<StatusBadge key="c" label="Changed since review" tone="attention" />, "A reviewed transaction changed in Actual afterwards."],
      [<StatusBadge key="e" label="Estimate" tone="muted" />, "Bench expects this statement; enter the bank's figures with Verify."],
      [<StatusBadge key="s" label="Starting point" tone="muted" />, "The first tracked statement, where history begins."],
    ]} />
  </>;
}

function Bills() {
  return <>
    <Para>Each statement is a bill. Bench assigns every payment to the bill it pays and keeps two figures: what is left to pay and how much of the minimum is left.</Para>
    <Heading>A worked example</Heading>
    <div role="img" aria-label="Amount due 1,000, paid 600 cleared, 100 pending: left to pay 400, minimum left 0"
      className="mb-3 flex flex-wrap items-center gap-2">
      <Box label="Amount due" value="1,000.00" /><Op>−</Op><Box label="Paid (cleared)" value="600.00" /><Op>=</Op><Box label="Left to pay" value="400.00" tone="result" />
      <span className="ml-4 text-xs text-muted-foreground">Minimum due 100.00 − Paid 600.00 → Minimum left 0.00 · Pending 100.00 is shown, never counted</span>
    </div>
    <Para>
      Paid counts only payments cleared in Actual. A payment that is not cleared yet appears as Pending (amber) until it clears. Your bank may call the
      amount due Total Payment Due; left blank, it is the statement balance.
    </Para>
    <Heading>Which bill a payment pays</Heading>
    <div role="img" aria-label="A payment pays the bill whose window contains it: from the day after the closing date until the later of the due date and the next closing date"
      className="mb-3 max-w-[55rem]">
      <div className="relative h-14">
        <div className="absolute inset-x-0 top-6 h-px bg-border" />
        <div className="absolute top-4 left-[10%] h-5 w-px bg-foreground" /><span className="absolute top-0 left-[6%] text-[11px]">Closes 07 Nov</span>
        <div className="absolute top-4 left-[55%] h-5 w-px bg-foreground" /><span className="absolute top-0 left-[51%] text-[11px]">Due 02 Dec</span>
        <div className="absolute top-4 left-[70%] h-5 w-px bg-muted-foreground" /><span className="absolute top-0 left-[66%] text-[11px] text-muted-foreground">Next close 07 Dec</span>
        <div className="absolute top-[22px] left-[10%] h-1 w-[60%] rounded bg-blue-500/40" />
        <span className="absolute top-9 left-[24%] text-[11px] text-blue-700 dark:text-blue-300">payments here pay the 07 Nov bill</span>
      </div>
    </div>
    <Para>Refunds and credits reduce what you owe but are never payments.</Para>
    <Heading>Payment status</Heading>
    <Example caption="The badge on each bill" head={["Badge", "Meaning"]} rows={[
      [<StatusBadge key="1" label="Due in 15 days" tone="neutral" />, "Nothing paid yet; the due date is ahead."],
      [<StatusBadge key="2" label="Due soon" tone="attention" />, "Due within 7 days and not paid in full."],
      [<StatusBadge key="3" label="Part paid" tone="neutral" />, "Some paid; more is left before the due date."],
      [<StatusBadge key="4" label="Pending" tone="info" />, "A payment made in time has not cleared in Actual yet."],
      [<StatusBadge key="5" label="Paid in full" tone="success" />, "Cleared payments reached the amount due by the due date."],
      [<StatusBadge key="6" label="Covered with credits" tone="success" />, "Refunds or credits cover what payments did not."],
      [<StatusBadge key="6b" label="Settled with a plan" tone="success" />, "The bank moved part of the bill into an instalment plan after it closed; payments covered the rest. Paid shows only real payments."],
      [<StatusBadge key="7" label="Paid late" tone="attention" />, "Paid in full, after the due date."],
      [<StatusBadge key="8" label="Minimum paid" tone="attention" />, "The minimum was paid; the rest carries and may attract interest."],
      [<StatusBadge key="9" label="Overdue" tone="danger" />, "The due date passed without the minimum."],
    ]} />
  </>;
}

const TYPE_ROWS: [string, string][] = [
  ["Purchase", "Spending on the card."],
  ["Cash advance", "Cash withdrawn on the card; often charged interest from day one."],
  ["Balance transfer", "Debt moved onto the card from another card."],
  ["Interest · Interest refund", "Interest the bank charged, or gave back."],
  ["Fee · Fee refund", "Fees the bank charged, or gave back."],
  ["Plan conversion · Plan instalment", "An instalment plan's principal moving off the card, and each billed instalment."],
  ["Payment", "Money paid to the card from another account."],
  ["Refund", "A merchant refund. It reduces what you owe but never counts as a payment."],
  ["Cashback", "Rewards credited to the card."],
  ["Adjustment · Transfer", "Bank corrections, and transfers that are neither payments nor plans."],
];

function Types() {
  return <>
    <Para>Every card transaction has a type. Types decide what counts as a payment, as interest and fees, or as plan movement. The Actual category never changes.</Para>
    <Heading>Types</Heading>
    <Example caption="The sign of the amount decides charge or credit" head={["Type", "Meaning"]} rows={TYPE_ROWS.map(([type, meaning]) => [type, meaning])} />
    <Heading>Where a type comes from</Heading>
    <Example caption="Shown on the type chip" head={["Mark", "Meaning"]} rows={[
      ["Suggested (dotted outline)", "Bench's guess from the payee and amount. Not counted as interest or fees until you accept it."],
      ["From category", "Your Category mappings say this category is interest, fees or cashback."],
      ["Set by you ✓", "You chose it in the type menu (press T on a row)."],
      ["From Actual", "Fixed by Actual itself, such as a transfer from your bank account."],
    ]} />
    <Para>Category mappings live in the card&apos;s Settings: map your Actual categories for interest, fees and cashback once and Bench types those transactions for you.</Para>
  </>;
}

const SCENARIOS = [
  { key: "balance", label: "Stays in the card balance" },
  { key: "billed", label: "Bank bills instalments on the card" },
  { key: "own", label: "Its own plan account" },
  { key: "shared", label: "Shared plan account (#tags)" },
] as const;

function Plans() {
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]["key"]>("billed");
  return <>
    <Para>{INSTALMENT_PLANS_DESCRIPTION}, often at 0%: instalment purchases (EMI), balance transfers and quick cash.</Para>
    <Para>
      Bench never creates a transaction or extra debt for a plan. It reads what you record in Actual, keeps the plan&apos;s balance in Total owed,
      and never counts plan movements as payments. Pick the way you record plans in Actual:
    </Para>
    <div role="tablist" aria-label="How the plan is recorded in Actual" className="mb-4 inline-flex flex-wrap overflow-hidden rounded-md border text-xs">
      {SCENARIOS.map(({ key, label }) => <button key={key} type="button" role="tab" aria-selected={scenario === key} onClick={() => setScenario(key)}
        className={cn("h-7 px-3 font-medium", scenario === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{label}</button>)}
    </div>
    <div role="tabpanel" aria-label={SCENARIOS.find(({ key }) => key === scenario)!.label}>
      {scenario === "balance" && <>
        <Para>Actual shows only the original purchase. The bank splits it into instalments on its side; the card balance in Actual stays as it is.</Para>
        <Example caption="A 6,000.00 laptop over 12 months" head={["Account", "Date", "Notes", "Amount"]} rows={[
          ["Card", "10 Aug", "Laptop store", "−6,000.00"],
        ]} />
        <Para>In the plan editor choose <b>Stays in card balance</b> and enter the terms; Bench estimates what remains from them.</Para>
      </>}
      {scenario === "billed" && <>
        <Para>The bank converts the purchase into a plan and bills one instalment on each statement. Every step is a card transaction in Actual.</Para>
        <Example caption="A 6,000.00 laptop over 12 months, closed early in month 4" head={["Account", "Date", "Notes", "Type", "Amount"]} rows={[
          ["Card", "10 Aug", "Laptop store", "Purchase · Original", "−6,000.00"],
          ["Card", "10 Aug", "Instalment plan booked", "Plan conversion", "+6,000.00"],
          ["Card", "07 Sep", "Instalment 1/12", "Plan instalment", "−500.00"],
          ["Card", "07 Oct", "Instalment 2/12", "Plan instalment", "−500.00"],
          ["Card", "20 Oct", "Plan settlement", "Plan instalment", "−5,000.00"],
        ]} />
        <Para>
          Start the plan from the purchase: open its Type menu and tick <b>Make this a plan</b>, then choose <b>Bank bills instalments</b>.
          The plan view suggests each instalment as it arrives; Link confirms it. For anything else, use <b>Add transaction</b> in the plan view.
        </Para>
      </>}
      {(scenario === "own" || scenario === "shared") && <>
        <div role="img" aria-label="A booking moves the plan balance from the card to the plan account; each instalment moves it back"
          className="mb-3 flex max-w-[55rem] items-center gap-3">
          <Box label="Card (on budget)" value="Your card" />
          <div className="flex flex-1 flex-col items-center gap-1 text-[11px] text-muted-foreground">
            <span>booking: the plan balance moves out →</span>
            <ArrowLeftRight className="size-4" aria-hidden />
            <span>← each instalment moves back</span>
          </div>
          <Box label="Plan account (off budget)" value={scenario === "shared" ? "Credit card loans" : "Laptop plan"} tone="bank" />
        </div>
        <Para>
          The card in Actual then shows only your everyday balance; the plan account&apos;s balance is what is left on the plan. Bench adds both into
          Total owed, and transfers with the plan account are never payments.
        </Para>
        <Example caption={scenario === "shared" ? "Two plans in one shared account, each with its #tag in the transfer notes" : "A 6,000.00 laptop plan in its own account"}
          head={["Account", "Date", "Notes", "Amount"]} rows={scenario === "shared" ? [
            ["Plan account", "10 Aug", <><Tag>#EMI_LAPTOP</Tag> Laptop booking</>, "−6,000.00"],
            ["Plan account", "09 Sep", <><Tag>#EMI_BT</Tag> Balance transfer</>, "−20,000.00"],
            ["Plan account", "07 Sep", <><Tag>#EMI_LAPTOP</Tag> Instalment</>, "+500.00"],
            ["Plan account", "07 Oct", <><Tag>#EMI_BT</Tag> 5% payment</>, "+1,000.00"],
            ["Plan account", "25 Nov", <><Tag>#EMI_BT</Tag> Remaining payment</>, "+19,000.00"],
          ] : [
            ["Plan account", "10 Aug", "Laptop booking", "−6,000.00"],
            ["Plan account", "07 Sep", "Instalment", "+500.00"],
            ["Plan account", "07 Oct", "Instalment", "+500.00"],
          ]} />
        {scenario === "shared" && <>
          <Heading>Tags</Heading>
          <Para>
            Give each plan one tag, such as <Tag>#EMI_LAPTOP</Tag>, and put it in the notes of every transfer for that plan. Keep one plan tag per
            transfer. Month tags such as <Tag>#2025-11</Tag> are statement tags and never name a plan; a bank or card tag such as <Tag>#DF</Tag> on
            every plan is fine.
          </Para>
        </>}
        <Heading>In Bench</Heading>
        <Para>
          In the card&apos;s Settings, answer Yes to <b>Separate plan account in Actual</b> and choose the account. Most banks print unbilled plan
          balances inside the statement balance; if yours does, tick <b>Statement balance includes plan balances</b> so statements still match.
          Bench then lists the plans it finds in the account{scenario === "shared" ? ", one per tag," : ""} on the Instalment Plans tab: Add plan fills
          in the details from Actual, and plans already paid off are saved as Finished.
        </Para>
      </>}
    </div>
    <Heading>Plan status</Heading>
    <Example caption="Shown on each plan" head={["Badge", "Meaning"]} rows={[
      [<StatusBadge key="1" label="On track" tone="success" />, "Instalments are arriving as expected."],
      [<StatusBadge key="2" label="Waiting for conversion" tone="attention" />, "The booking has not reached the plan account yet."],
      [<StatusBadge key="3" label="Oct instalment not seen" tone="attention" />, "An instalment is more than 5 days late."],
      [<StatusBadge key="4" label="Finished" tone="neutral" />, "Paid off, in instalments or closed early."],
    ]} />
  </>;
}

function Figures() {
  return <>
    <Heading>Total owed</Heading>
    <div role="img" aria-label="Card balance plus plan balances in plan accounts equals Total owed" className="mb-3 flex flex-wrap items-center gap-2">
      <Box label="On the card" value="14,514.14" /><Op>+</Op><Box label="In plan accounts" value="4,000.00" /><Op>=</Op><Box label="Total owed" value="18,514.14" tone="result" />
    </div>
    <Para>Everything you owe for the card today, from Actual. Money moving between the card and a plan account on different days is counted once.</Para>
    <Heading>Other figures</Heading>
    <Example caption="On Overview and All cards" head={["Figure", "Meaning"]} rows={[
      ["Statement balance", "What the latest bank statement printed."],
      ["New since statement", "Card activity after the latest statement closed: the gap between the statement balance and Total owed."],
      ["Credit limit", "The limit you set, plus any changes recorded in Settings › Record a limit change, each from its effective date (any day)."],
      ["Available credit", "The limit in effect today minus Total owed. Bench's figure, not the bank's live one."],
      ["Credit used", "The share of today's limit Total owed takes up."],
      ["Interest & fees", "What the bank charged over the period shown, from the transactions' types."],
    ]} />
    <Heading>Balance over time</Heading>
    <Example caption="Reading the chart on a card's Overview" head={["Mark", "Meaning"]} rows={[
      ["Black dot with a label", "A statement closing: its balance and % of the limit it had on that date."],
      ["Dashed grey step", "The credit limit over time, stepping on each recorded change."],
      ["Diamond on the Bills row", "A bill's due date, coloured by its outcome: green paid in full, amber minimum or late, red overdue, outline upcoming."],
      ["Amber bar on the Interest row", "Interest and fees charged on that statement."],
      ["Blue shading · hatched shading", "Days with no interest (the bill was paid in full) · periods where interest was charged."],
      ["Dashed blue step", "Total owed if you pay Left to pay by the due date."],
    ]} />
  </>;
}

function Keyboard() {
  return <>
    <Para>Every table is one tab stop: Tab moves into it, then the keys below work on the focused row.</Para>
    <Example caption="Everywhere" head={["Keys", "Action"]} rows={[
      [<><Key>↑</Key> <Key>↓</Key></>, "Move between rows"],
      [<Key key="e">Enter</Key>, "Open the row (a card, statement, payment or plan)"],
      [<><Key>Shift</Key> + <Key>F10</Key></>, "Open the row's ⋯ menu"],
      [<Key key="esc">Esc</Key>, "Close the side panel or dialog"],
      [<Key key="s">/</Key>, "Search (Activity)"],
    ]} />
    <Example caption="Statement review and Activity" head={["Keys", "Action"]} rows={[
      [<><Key>Y</Key> <Key>N</Key> <Key>?</Key></>, "Answer On this statement, Not on this statement or Unsure"],
      [<Key key="t">T</Key>, "Change the row's type"],
      [<Key key="sp">Space</Key>, "Select the row (Activity)"],
      [<Key key="en">Enter</Key>, "Edit your note (statement review)"],
    ]} />
  </>;
}

function Glossary({ onSection }: { onSection: (section: GuideSection) => void }) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const terms = GLOSSARY.filter(({ term, definition }) => !needle || `${term} ${definition}`.toLowerCase().includes(needle))
    .sort((a, b) => a.term.localeCompare(b.term));
  const sectionName = (id: GuideSection) => SECTIONS.find(([key]) => key === id)![1];
  return <>
    <SearchInput size="sm" className="mb-4 w-72" aria-label="Search the glossary" value={search} onValueChange={setSearch} />
    {terms.length ? <dl className="max-w-[55rem] divide-y">{terms.map(({ term, definition, section }) => <div key={term} className="grid gap-1 py-2 sm:grid-cols-[220px_1fr]">
      <dt className="text-xs font-medium">{term}</dt>
      <dd className="text-xs leading-relaxed text-foreground/80">
        {definition}{" "}
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSection(section)}>{sectionName(section)} →</button>
      </dd>
    </div>)}</dl> : <p className="text-xs text-muted-foreground">No terms match.</p>}
  </>;
}
