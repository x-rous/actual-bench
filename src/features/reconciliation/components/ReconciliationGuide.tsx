"use client";
import type { ReactNode } from "react";
import {
  ArrowRight, BookOpen, Check, CheckCircle2, CircleHelp, FileText, GitCompareArrows, Landmark, Lightbulb, ListChecks, PlayCircle, RefreshCw,
  ShieldCheck, TriangleAlert, Upload, type LucideIcon,
} from "lucide-react";
import { GuideFrame } from "@/components/ui/guide-frame";
import { cn } from "@/lib/utils";
import { Example, Heading, Key, Para, Steps, Tag } from "@/features/credit-cards/components/guide/CreditCardGuide";

/**
 * The Bank Reconciliation guide: one dialog, the picture first and the words second, following one small
 * statement through the four steps - Import, Reconcile, Review, Apply - so each section builds on the last.
 */
export type ReconciliationGuideSection =
  | "start" | "import" | "pdf" | "matching" | "decisions" | "review" | "apply" | "sessions" | "glossary";

export const RECONCILIATION_GUIDE_SECTIONS: [ReconciliationGuideSection, string][] = [
  ["start", "Getting started"], ["import", "Importing a statement"], ["pdf", "PDF statements"], ["matching", "How rows are matched"],
  ["decisions", "Making decisions"], ["review", "Reviewing the plan"], ["apply", "Applying safely"], ["sessions", "Sessions & the list"],
  ["glossary", "Glossary"],
];

const SECTION_ICONS: Record<ReconciliationGuideSection, LucideIcon> = {
  start: BookOpen, import: Upload, pdf: FileText, matching: GitCompareArrows, decisions: CheckCircle2,
  review: ListChecks, apply: ShieldCheck, sessions: RefreshCw, glossary: CircleHelp,
};

type Tone = "bank" | "actual" | "match" | "new" | "warn" | "muted" | "bad";
const TONES: Record<Tone, string> = {
  bank: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  actual: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  match: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  new: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  warn: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  muted: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  bad: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
};
const Chip = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONES[tone])}>{children}</span>;

function Callout({ tone = "tip", title, children }: { tone?: "tip" | "warn"; title: string; children: ReactNode }) {
  const Icon = tone === "tip" ? Lightbulb : TriangleAlert;
  return <aside className={cn("my-4 flex max-w-[55rem] gap-3 rounded-xl border px-4 py-3.5 text-xs", tone === "tip" ? "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20" : "border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20")}>
    <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "tip" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400")} aria-hidden />
    <div><p className="font-semibold">{title}</p><div className="mt-1 leading-relaxed text-foreground/80">{children}</div></div>
  </aside>;
}

const Card = ({ icon: Icon, title, tone, children }: { icon: typeof Landmark; title: string; tone: Tone; children: ReactNode }) => <div className={cn("h-full rounded-xl border p-4 shadow-sm", TONES[tone])}>
  <div className="flex items-center gap-2 text-xs font-semibold"><Icon className="size-4" aria-hidden />{title}</div>
  <div className="mt-1.5 text-xs leading-relaxed text-foreground/80">{children}</div>
</div>;

const Amount = ({ children, negative }: { children: ReactNode; negative?: boolean }) => <span className={cn("tabular-nums", negative ? "text-red-700 dark:text-red-400" : "text-foreground")}>{children}</span>;

/** The four steps as a connected strip, with the one that is being explained lit. */
function Journey({ active }: { active?: number }) {
  const steps: [string, string, typeof Upload][] = [
    ["Import", "Read the statement", Upload], ["Reconcile", "Match and decide", GitCompareArrows],
    ["Review", "Check the plan", ListChecks], ["Apply", "Write to Actual", PlayCircle],
  ];
  return <ol aria-label="The four steps" className="my-3 flex max-w-[64.5rem] flex-col gap-2 sm:flex-row sm:items-stretch">
    {steps.map(([title, caption, Icon], index) => <li key={title} className="flex flex-1 items-stretch gap-2">
      <div aria-current={active === index ? "step" : undefined} className={cn("flex h-full flex-1 items-center gap-3 rounded-lg border px-3 py-2", active === index ? "border-foreground bg-accent" : "bg-background")}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background"><Icon className="size-3.5" aria-hidden /></span>
        <div className="text-xs"><p className="font-semibold">{index + 1}. {title}</p><p className="text-muted-foreground">{caption}</p></div>
      </div>
      {index < steps.length - 1 && <ArrowRight className="hidden size-4 shrink-0 self-center text-muted-foreground sm:block" aria-hidden />}
    </li>)}
  </ol>;
}

/** Statement rows beside the Actual transactions they were paired with, for the matching picture. */
function Pairing() {
  const pair = (left: string, right: string, tone: Tone, label: string) => <li className="grid grid-cols-[1fr_10rem_1fr] items-center gap-2 text-xs">
    <span className="truncate rounded border bg-background px-2 py-1">{left}</span>
    <span className="flex flex-col items-center"><Chip tone={tone}>{label}</Chip><span className="text-muted-foreground" aria-hidden>↔</span></span>
    <span className={cn("truncate rounded border px-2 py-1", right ? "bg-background" : "border-dashed text-muted-foreground")}>{right || "nothing in Actual"}</span>
  </li>;
  return <figure className="my-3 max-w-[55rem] rounded-lg border bg-background p-3" aria-label="Statement rows paired with Actual transactions">
    <div className="mb-2 flex justify-between text-[11px] font-semibold text-muted-foreground uppercase"><span>Bank statement</span><span>Actual</span></div>
    <ul className="space-y-2">
      {pair("04 Aug · COFFEE HOUSE · -18.50", "04 Aug · Coffee House · -18.50", "match", "Matched")}
      {pair("05 Aug · GROCER · -62.10", "06 Aug · Grocer · -62.10", "match", "Matched (date differs)")}
      {pair("07 Aug · PHARMACY · -24.00", "", "new", "Not in Actual")}
      {pair("09 Aug · TAXI · -12.00", "09 Aug · Taxi · -12.00 / Taxi · -12.00", "warn", "Several candidates")}
      {pair("11 Aug · BOOKSHOP · -45.00", "11 Aug · Bookshop · -54.00", "warn", "Amount differs")}
    </ul>
    <figcaption className="mt-2 text-[11px] text-muted-foreground">Rows on the statement are on the left; the transaction each one was paired with in Actual is on the right.</figcaption>
  </figure>;
}

/** A schematic PDF page with its columns drawn the way the detection step draws them. */
function PdfSketch() {
  const cols: [number, number, string, string][] = [[14, 52, "#2563eb", "Trans. date"], [58, 96, "#9333ea", "Posting date"], [102, 190, "#0d9488", "Description"], [196, 236, "#dc2626", "Money out"], [242, 282, "#16a34a", "Money in"]];
  const rows = [58, 70, 82, 94, 106];
  return <figure className="my-3 max-w-[41.5rem] rounded-lg border bg-background p-3" aria-label="Sketch of a PDF statement with its columns mapped">
    <svg viewBox="0 0 300 130" className="w-full" role="img" aria-label="A statement page: a table area with five coloured columns and five transaction rows">
      <rect x="4" y="4" width="292" height="122" rx="3" fill="none" stroke="currentColor" strokeOpacity="0.25" />
      <rect x="10" y="10" width="140" height="8" rx="2" fill="currentColor" opacity="0.15" /><rect x="10" y="22" width="90" height="5" rx="2" fill="currentColor" opacity="0.1" />
      <rect x="10" y="44" width="280" height="76" rx="2" fill="#10b981" fillOpacity="0.07" stroke="#10b981" strokeOpacity="0.6" strokeDasharray="3 2" />
      {cols.map(([x1, x2, color, label]) => <g key={label}>
        <rect x={x1} y="44" width={x2 - x1} height="76" fill={color} fillOpacity="0.1" stroke={color} strokeOpacity="0.5" />
        <text x={x1 + 2} y="52" fontSize="5.5" fill={color} fontWeight="600">{label}</text>
      </g>)}
      {rows.map((y, index) => <g key={y} fill="currentColor" opacity="0.45">
        <rect x="16" y={y} width="28" height="3" rx="1" /><rect x="60" y={y} width="28" height="3" rx="1" /><rect x="104" y={y} width={50 + (index % 3) * 18} height="3" rx="1" />
        {index !== 2 ? <rect x="206" y={y} width="22" height="3" rx="1" /> : <rect x="252" y={y} width="22" height="3" rx="1" />}
      </g>)}
    </svg>
    <figcaption className="mt-1 text-[11px] text-muted-foreground">The dashed green box is the <b>transaction area</b>; each colour is a <b>column</b> with a role. Everything outside the area is read for the period, currency and balances but never becomes a transaction.</figcaption>
  </figure>;
}

/** The write-before-and-after of a Review row, with the changing values in amber. */
function BeforeAfter() {
  const cell = "px-2 py-1.5 align-top";
  return <div className="my-3 max-w-[55rem] overflow-x-auto rounded-lg border">
    <table className="w-full min-w-[34rem] border-collapse text-xs">
      <caption className="sr-only">One statement row and the transaction it becomes in Actual</caption>
      <thead className="bg-muted/50 text-[11px] text-muted-foreground"><tr>
        <th scope="col" className={cn(cell, "text-left")} colSpan={2}>From the bank statement</th><th scope="col" className={cn(cell, "border-l text-left")}>Will</th><th scope="col" className={cn(cell, "border-l text-left")} colSpan={3}>Resulting transaction in Actual</th>
      </tr></thead>
      <tbody>
        <tr className="border-t"><td className={cell}>05 Aug<br /><span className="text-muted-foreground">GROCER 0183 DUBAI</span></td><td className={cn(cell, "text-right")}><Amount negative>-62.10</Amount></td>
          <td className={cn(cell, "border-l text-muted-foreground")}>Imported payee</td>
          <td className={cell}>06 Aug</td><td className={cell}>Grocer<br /><span className="text-muted-foreground">Imported payee: GROCER 0183 DUBAI</span></td><td className={cn(cell, "text-right")}><Amount negative>-62.10</Amount></td></tr>
        <tr className="border-t"><td className={cell}>11 Aug<br /><span className="text-muted-foreground">BOOKSHOP</span></td><td className={cn(cell, "text-right")}><Amount negative>-45.00</Amount></td>
          <td className={cn(cell, "border-l font-medium text-amber-700 dark:text-amber-400")}>Update</td>
          <td className={cell}>11 Aug</td><td className={cell}>Bookshop</td><td className={cn(cell, "text-right text-amber-700 dark:text-amber-400")} title="was -54.00"><Amount negative>-45.00</Amount></td></tr>
        <tr className="border-t"><td className={cell}>07 Aug<br /><span className="text-muted-foreground">PHARMACY</span></td><td className={cn(cell, "text-right")}><Amount negative>-24.00</Amount></td>
          <td className={cn(cell, "border-l font-medium text-blue-700 dark:text-blue-400")}>Create</td>
          <td className={cell}>07 Aug</td><td className={cell}>Pharmacy <span className="text-muted-foreground">(or left for your rules)</span></td><td className={cn(cell, "text-right")}><Amount negative>-24.00</Amount></td></tr>
      </tbody>
    </table>
    <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">Amber is a value that is changing. The grocer row only gains its imported payee, so it is shown muted: payee, notes and category stay exactly as they were.</p>
  </div>;
}

/** The apply pre-flight as a vertical flow. */
function ApplyFlow() {
  const steps: [string, string, Tone][] = [
    ["Decisions are saved", "A failed save has to be retried before anything is written.", "muted"],
    ["Every affected transaction is re-read from Actual", "Nothing is assumed from when the session was opened.", "actual"],
    ["Safe rows are written", "A note edited meanwhile gets your change replayed onto it; an amount or date corrected in Actual is left as Actual has it.", "match"],
    ["Conflicts are held back", "A row that cannot be combined safely is reported, never overwritten.", "warn"],
    ["The account is read again", "The result is verified, then listed as applied, skipped or failed.", "muted"],
  ];
  return <ol className="my-3 max-w-[55rem] space-y-1.5" aria-label="What Apply does, in order">
    {steps.map(([title, body, tone], index) => <li key={title} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2 text-xs", TONES[tone])}>
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">{index + 1}</span>
      <div><p className="font-semibold">{title}</p><p className="text-foreground/80">{body}</p></div>
    </li>)}
  </ol>;
}

const SESSION_STATES: [string, Tone, string][] = [
  ["Draft", "muted", "Started, no statement imported yet. Opens on Import. A draft is always listed, whatever year is selected."],
  ["In progress", "warn", "Imported and being matched or decided. Opens on the workbench."],
  ["Ready to apply", "actual", "Every row is decided. Opens on the workbench; go on to Review from there."],
  ["Applying", "actual", "A write is running right now."],
  ["Applied", "match", "Written and verified. Kept as an audit record, read-only."],
  ["Applied with problems", "bad", "Some actions were skipped or failed. Retry what failed, or decide the rest."],
  ["Failed", "bad", "Nothing could be written. Fix the cause and retry."],
];

export function ReconciliationGuide({ section, onSection, onClose, docsUrl }: { section: ReconciliationGuideSection; onSection: (section: ReconciliationGuideSection) => void; onClose: () => void; docsUrl?: string }) {
  const link = (to: ReconciliationGuideSection, text: string) => <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSection(to)}>{text}</button>;
  return <GuideFrame title="Bank Reconciliation guide" description="Check a bank statement against one Actual account, decide every difference, and write only what you approved." docsUrl={docsUrl} sections={RECONCILIATION_GUIDE_SECTIONS} icons={SECTION_ICONS} section={section} onSection={onSection} onClose={onClose}>
          {section === "start" && <>
            <Para>Bank Reconciliation compares a statement you downloaded from your bank with <b>one account</b> in Actual. It shows what agrees, what is missing on either side, and what disagrees, lets you decide each difference, and writes only what you approved. It is for auditing a period or fixing it, not for everyday entry or bank sync.</Para>
            <div className="grid max-w-[64.5rem] gap-3 sm:grid-cols-3">
              <Card tone="bank" icon={FileText} title="The statement">A CSV, TSV, OFX, QFX, QIF or text-based PDF from your bank. It is read in this session; no bank connection or credentials are needed. See {link("import", "Importing a statement")}.</Card>
              <Card tone="actual" icon={Landmark} title="The Actual account">The account&apos;s transactions are read from Actual, and every row is compared against them. See {link("matching", "How rows are matched")}.</Card>
              <Card tone="match" icon={ShieldCheck} title="The plan">Your decisions build a plan. <b>Nothing is written until you Apply</b>, and Apply re-checks everything first. See {link("apply", "Applying safely")}.</Card>
            </div>
            <Heading>The four steps</Heading>
            <Journey />
            <Para>Select <b>New reconciliation</b>, choose the account, and add an optional tag such as “August close”; the account cannot be changed afterwards. <b>Import</b> reads the statement, <b>Reconcile</b> is where you settle each difference in the workbench, <b>Review</b> shows the plan row by row, and <b>Apply</b> writes it. Each step has its own section in this guide.</Para>
            <Callout title="You can stop at any time">A session is saved as you go, so you can close the tab and come back to the same place. Decisions stay in the session until you Apply, and an applied session stays as an audit record.</Callout>
            <Callout tone="warn" title="Categories are never written">Reconciliation does not set or change a category. A new transaction is categorised only if your Actual rules do it.</Callout>
          </>}

          {section === "import" && <>
            <Para>Upload a file or paste its text. The import screen shows the rows it read <b>before</b> you continue, so mistakes are cheap to catch.</Para>
            <div className="flex max-w-[55rem] flex-wrap gap-2">{["CSV", "TSV", "OFX", "QFX", "QIF", "PDF (text-based)"].map((format) => <Chip key={format} tone="bank">{format}</Chip>)}</div>
            <Para>OFX and QIF are recognised from their contents, so an OFX export saved as <Tag>.txt</Tag> still imports as OFX.</Para>
            <Heading>Check three things before matching</Heading>
            <Steps items={[
              ["Columns", "For a CSV, map the date, amount, payee and notes columns. Use separate debit and credit columns when the bank gives no single signed amount."],
              ["Date format", "Day/month or month/day. A wrong choice quietly moves dates, so check one row you know."],
              ["Sign convention", "Money out must be negative. If the bank prints spending as positive, correct it here."],
            ]} />
            <Heading>Two kinds of text from the bank</Heading>
            <div className="grid max-w-[55rem] grid-cols-[1fr_auto_1fr] items-stretch gap-x-2 gap-y-2">
              <div className={cn("rounded-lg border p-3 text-xs", TONES.bank)}><p className="font-semibold">Merchant / payee</p><p className="mt-0.5 text-foreground/80">“GROCER 0183 DUBAI”</p></div>
              <ArrowRight className="size-4 self-center text-muted-foreground" aria-hidden />
              <div className={cn("rounded-lg border p-3 text-xs", TONES.actual)}><p className="font-semibold">Imported payee</p><p className="mt-0.5 text-foreground/80">What the bank called it. Never replaces your own payee.</p></div>
              <div className={cn("rounded-lg border p-3 text-xs", TONES.bank)}><p className="font-semibold">Memo / details</p><p className="mt-0.5 text-foreground/80">“CARD 4471 · REF 88213”</p></div>
              <ArrowRight className="size-4 self-center text-muted-foreground" aria-hidden />
              <div className={cn("rounded-lg border p-3 text-xs", TONES.actual)}><p className="font-semibold">Notes</p><p className="mt-0.5 text-foreground/80">Used for the notes of new transactions, if you choose to keep it.</p></div>
            </div>
            <Heading>When a row is not in Actual</Heading>
            <Para>Choose how a missing transaction is created: take the payee from the statement (an Actual payee is found or created) or leave it blank for your rules, and keep the memo, the payee, both or neither in the notes. You can change this later under <b>Re-run</b>; notes you already edited keep their value.</Para>
            <Callout title="Reusing your setup">For CSV files, save a <b>reconciliation profile</b> on the account to keep the column mapping, date and amount conventions, and matching options for next month. Importing the same statement twice is allowed, with a warning that names the earlier session.</Callout>
            <Callout title="Credit cards">If the account is a card you added under Credit Cards, tick <b>Also enter this card&apos;s bank statement figures</b> when you start. After you apply, <b>Review statement</b> opens that statement in Credit Cards.</Callout>
          </>}

          {section === "pdf" && <>
            <Para>A PDF is read <b>in your browser</b>: it is not uploaded or stored, and a password is kept in memory only. Because a PDF has no columns of its own, the reader first works out where the transactions are, then lets you check it.</Para>
            <PdfSketch />
            <Heading>Two screens</Heading>
            <div className="grid max-w-[64.5rem] gap-3 sm:grid-cols-2">
              <Card tone="bank" icon={ListChecks} title="1 · Check detection">Where the transaction areas and columns are, how dates, signs and amounts are read, and the statement period and currency. Change anything, <b>Preview</b> the effect, then <b>Apply changes and review</b>. The actions are at the top of the settings column.</Card>
              <Card tone="match" icon={CheckCircle2} title="2 · Review transactions">Every row read, each <Chip tone="match">Ready</Chip> <Chip tone="warn">Review</Chip> or <Chip tone="bad">Fix</Chip>. Edit a date, description or amount in place; the eye icon shows where on the page a value came from.</Card>
            </div>
            <Heading>Working the rows</Heading>
            <Example caption="What each status asks of you" head={["Status", "Meaning", "What to do"]} rows={[
              [<Chip key="r" tone="match">Ready</Chip>, "Read with confidence", "Nothing"],
              [<Chip key="v" tone="warn">Review</Chip>, "Read, but worth a look", "Check it against the statement, then Mark reviewed"],
              [<Chip key="f" tone="bad">Fix</Chip>, "A required value is missing or invalid", "Correct it, or ignore the row"],
            ]} />
            <ul className="mb-3 max-w-[55rem] list-disc space-y-1 pl-5 text-xs leading-relaxed text-foreground/80">
              <li><b>Possible duplicate</b> is a hint, not an error: the same charge twice on one day is normal. Mark each reviewed, or ignore the repeat.</li>
              <li><b>Add transaction</b> adds a row the statement does not show. It goes at the end, stays <Chip tone="bad">Fix</Chip> until its date, description and amount are filled in, and counts in the totals.</li>
              <li>Select several rows to set their direction, merge, ignore, or mark them reviewed together. <Key>Ctrl</Key> + <Key>Enter</Key> marks the current row reviewed.</li>
              <li>Undo and redo reverse corrections one at a time.</li>
            </ul>
            <Heading>Pages that could not be read</Heading>
            <Para>A page with no text layer (a scan) has no transactions the reader can see. Import stays off until you confirm <b>I checked these pages</b>. A page your layout leaves out with <b>Ignore first / last N pages</b> is not reported.</Para>
            <Callout title="Save the layout">Once a statement reads well, <b>Save layout</b> keeps the columns and reading settings under the bank&apos;s name (transaction areas belong to one statement and are not saved), so next month&apos;s statement is read the same way. Layouts are shared across accounts and are not versioned.</Callout>
          </>}

          {section === "matching" && <>
            <Para>After import, every statement row is compared with the Actual account. The one hard rule: <b>an automatic match needs the exact signed amount</b>. Date and text only rank candidates that already have that amount; they never create a match by themselves.</Para>
            <Pairing />
            <Heading>Where each row lands</Heading>
            <Example caption="The filters on the workbench" head={["Filter", "What it means"]} rows={[
              [<Chip key="m" tone="match">Matched</Chip>, "Paired with an Actual transaction. Nothing is written unless you staged a change."],
              [<Chip key="n" tone="new">Not in Actual</Chip>, "On the statement with nothing to pair with. These become new transactions if you create them."],
              [<Chip key="a" tone="warn">Needs review</Chip>, "The matcher would not decide alone: several candidates, an amount that differs, a likely wrong amount, duplicates, or rows that need pairing."],
              [<Chip key="s" tone="bank">Not on statement</Chip>, "In Actual within the statement's dates but not mentioned by the statement. Not counted against coverage."],
              [<Chip key="o" tone="muted">Outside period</Chip>, "Loaded only to help match rows near the edges. Kept by default and not counted as work."],
            ]} />
            <Heading>What the text is compared against</Heading>
            <Para>Choose where your merchant text lives in Actual: <b>Payee</b>, <b>Imported payee</b>, <b>Notes</b>, or <b>All, best match</b>. Names are compared by similarity; notes by containment, so the bank text can sit inside a longer note. Changes take effect when you <b>Re-run</b>.</Para>
            <Callout title="Nothing matched at all?">If every row is a mismatch, the statement probably prints spending as positive. <b>Re-run inverted</b> is offered only when reversing the signs would explain it.</Callout>
          </>}

          {section === "decisions" && <>
            <Para>Every difference gets a decision. You can work through them in any order, and you can move on to Review with some left open: <b>Apply never touches an undecided row</b>.</Para>
            <Example caption="What you can decide about a row" head={["Row", "Decision", "Effect when applied"]} rows={[
              ["Statement row with a candidate", "Accept the match, or pick another candidate", "Nothing, unless an amount or date correction is staged"],
              ["Two rows that are not the same", "Not the same transaction", "The statement row can then be created; the Actual one stays to keep or delete"],
              ["Statement row, nothing in Actual", "Create", "A new transaction is written"],
              ["Duplicate in Actual", "Delete", "That transaction is deleted"],
              ["Amount differs", "Use the statement amount", "The Actual amount is corrected on the same transaction"],
              ["Actual transaction not on the statement", "Keep (the default)", "Nothing"],
            ]} />
            <Heading>Several rows, several candidates</Heading>
            <Para>When bank rows share the same merchant and date, open one and choose <b>Resolve group</b>. Bank rows run down a grid and Actual transactions across it; pick a cell, read the comparison, and select <b>Use this match</b>. Each pair you confirm frees the others, and <b>Undo last pairing</b> takes it back during this visit.</Para>
            <div className="my-3 max-w-[32rem] overflow-hidden rounded-lg border text-xs" role="img" aria-label="A grid pairing two bank rows with two Actual transactions">
              <div className="grid grid-cols-3 bg-muted/50 text-[11px] text-muted-foreground"><span className="p-2" /><span className="p-2 font-medium">Taxi · 09 Aug<br />-12.00</span><span className="p-2 font-medium">Taxi · 09 Aug<br />-12.00</span></div>
              {[["Bank: TAXI -12.00", true, false], ["Bank: TAXI -12.00", false, true]].map(([label, a, b], index) => <div key={index} className="grid grid-cols-3 border-t">
                <span className="p-2 font-medium">{label as string}</span>
                <span className={cn("m-1 flex items-center justify-center rounded border text-[11px]", a ? TONES.match : "text-muted-foreground")}>{a ? <><Check className="mr-1 size-3" aria-hidden />paired</> : "same day"}</span>
                <span className={cn("m-1 flex items-center justify-center rounded border text-[11px]", b ? TONES.match : "text-muted-foreground")}>{b ? <><Check className="mr-1 size-3" aria-hidden />paired</> : "same day"}</span>
              </div>)}
            </div>
            <Heading>When amounts disagree</Heading>
            <Para>Accepting a pair whose amounts differ stages the <b>statement amount on the existing transaction</b>, keeping its id, payee, notes, category, schedule and transfer link. Select several rows and choose <b>Use the statement amount</b> to do it in bulk; <b>Undo that</b> reverses it until your next edit. On a match with different dates, <b>Use statement date</b> stages the bank&apos;s date the same way.</Para>
            <Callout tone="warn" title="Some transactions are protected">A reconciled transaction, a split parent, or one leg of a transfer is never changed here. You can still record the match; Review then reports the difference that remains.</Callout>
            <Heading>Transform several rows</Heading>
            <Para><b>Transform</b> previews and stages a payee change or note edits across many rows at once, with conditions on payee, category or tag. It never overwrites a hand-edited value unless you choose to, and writes nothing until Apply.</Para>
          </>}

          {section === "review" && <>
            <Para>Review is the last look before anything happens. It shows, row by row, what each statement row will look like in Actual afterwards, with the net effect on the balance stated up front.</Para>
            <Journey active={2} />
            <BeforeAfter />
            <Heading>Reading the summary</Heading>
            <div className="grid max-w-[55rem] grid-cols-2 gap-2 sm:grid-cols-4">
              {([["Create", "new transactions", "new"], ["Update", "changes you staged", "warn"], ["Delete", "duplicates removed", "bad"], ["No change needed", "already correct", "muted"]] as [string, string, Tone][]).map(([label, detail, tone]) => <div key={label} className={cn("rounded-lg border px-3 py-2", TONES[tone])}><p className="text-xs font-semibold">{label}</p><p className="text-[11px] opacity-80">{detail}</p></div>)}
            </div>
            <Heading>Imported payee, in plain words</Heading>
            <Para>Actual keeps what the bank called a transaction in a field named <b>imported payee</b>, separate from your curated payee. When a matched transaction only gains that, the row says <Chip tone="muted">Imported payee</Chip> instead of an amber Update, because nothing you curated changes. If it would replace an imported payee that was already there, it is amber and shows what it was.</Para>
            <Heading>Two choices that shape the write</Heading>
            <Example caption="Both are set on this screen and locked once Apply starts" head={["Setting", "Options"]} rows={[
              ["Mark as cleared", "Leave alone · New only · Everything confirmed (also clears matched rows that need no other change)"],
              ["Save the statement's text as imported payee", "On new and matched rows (the default) · On new rows only"],
            ]} />
            <Example caption="What is written, field by field" head={["Field", "New transaction", "Matched transaction"]} rows={[
              ["Imported payee", "The statement payee, when there is one", "Only if you chose to include matched rows"],
              ["Payee", "Resolved from the statement, or left to your rules", "Kept unless you staged a change"],
              ["Notes", "Follow your Import choice", "Kept unless you staged a change"],
              ["Category", "Only what your Actual rules set", "Always kept"],
            ]} />
          </>}

          {section === "apply" && <>
            <Para>Apply writes your approved decisions to Actual. Before it does, it checks that Actual still looks the way it did when you decided.</Para>
            <Journey active={3} />
            <ApplyFlow />
            <Heading>If something goes wrong</Heading>
            <Example caption="What each outcome means and what to do" head={["Outcome", "Meaning", "Your move"]} rows={[
              ["Applied", "Written and verified", "Nothing. The session stays as a record"],
              ["Skipped", "Already done, or protected", "Nothing"],
              ["Held back", "Actual changed in a way that could not be combined safely", "Review the row, then decide again"],
              ["Failed", "The write did not go through", "Retry what failed (only unfinished work is attempted)"],
              ["Interrupted", "The tab closed during a write", "Recover interrupted Apply, once the original tab has stopped. It reads Actual and repeats no write"],
            ]} />
            <div className="my-3 flex max-w-[55rem] items-start gap-3 rounded-lg border bg-muted/30 p-3 text-xs">
              <RefreshCw className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="leading-relaxed text-foreground/80">Created transactions carry a deterministic marker, so retrying after a partial run never creates the same one twice, even if the session lost track of the run.</p>
            </div>
            <Callout title="An applied session is a record">It cannot be matched again. Its Review page stays readable and its write choices are locked to what was used. To reconcile the account again, start a new session.</Callout>
          </>}

          {section === "sessions" && <>
            <Para>The main page lists one row per reconciliation: account, tag, statement format and file, period, row count and status. Open a session to continue where its work is at: a draft opens on Import, an applied one on its result, anything else on the workbench.</Para>
            <Heading>Status</Heading>
            <ul className="max-w-[55rem] space-y-1.5">{SESSION_STATES.map(([label, tone, body]) => <li key={label} className="flex items-start gap-3 text-xs"><span className="w-40 shrink-0"><Chip tone={tone}>{label}</Chip></span><span className="leading-relaxed text-foreground/80">{body}</span></li>)}</ul>
            <Heading>Finding a session</Heading>
            <Example caption="The filters above the table" head={["Filter", "How it behaves"]} rows={[
              ["Search", "Account, statement name, tag and period start"],
              ["Status", "Only statuses you actually have are offered"],
              ["Account, Tag", "Narrow to one account, or to a label such as “August close”"],
              ["Period (year)", "Starts on the current year when it has sessions. A statement that runs across New Year answers to both years. Drafts are always shown"],
              ["Group by account", "Gathers an account's sessions under one heading. Off by default"],
            ]} />
            <Callout title="Where sessions are kept">Sessions live in Actual Bench&apos;s own database on the server, not in the budget file. They hold the imported rows, your decisions and the apply result, so statement contents stay there until you delete the session. Deleting a session never changes your budget, and applied changes stay applied.</Callout>
            <Heading>Limits</Heading>
            <ul className="mb-3 max-w-[55rem] list-disc space-y-1 pl-5 text-xs leading-relaxed text-foreground/80">
              <li>One account per session.</li>
              <li>Split children are read-only; a split transaction can be matched but its lines cannot be edited here.</li>
              <li>A manual pairing is limited to transactions loaded for the session&apos;s date range.</li>
            </ul>
          </>}

          {section === "glossary" && <>
            <Example caption="Terms used on these screens" head={["Term", "Meaning"]} rows={[
              ["Session", "One reconciliation of one account against one statement, saved as you work"],
              ["Statement row", "A line on the bank statement"],
              ["Match / pair", "A statement row and the Actual transaction it stands for"],
              ["Candidate", "An Actual transaction that could be the match for a row"],
              ["Undecided", "A row you have not settled. Apply leaves it alone"],
              ["Staged", "A change recorded in the session, not yet written"],
              ["Imported payee", "What the bank called the transaction, kept separately from your curated payee"],
              ["Coverage", "How much of the statement, and of the account's period, has a counterpart"],
              ["Transaction area / column", "The parts of a PDF page that hold transactions, and what each column means"],
              ["Layout", "A saved PDF reading for one bank's statements"],
              ["Profile", "A saved CSV setup for one account: columns, conventions, matching options"],
              ["Pre-flight", "The re-read of every affected transaction just before Apply writes"],
              ["Marker", "An id on a created transaction that stops a retry creating it twice"],
            ]} />
          </>}
  </GuideFrame>;
}
