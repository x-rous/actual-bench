import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { BUDGET_TINT } from "../charts/BudgetBars";

/**
 * The pictures of the Financial Insights guide: small static sketches that use the page's own colours (the same `--fi-*` tokens the
 * charts use), so what a reader sees here is what they will see on the page. Nothing here reads data.
 */

export type Tone = "income" | "spend" | "kept" | "value" | "loan" | "neutral" | "warn";
const TONES: Record<Tone, string> = {
  income: "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200",
  spend: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
  kept: "border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200",
  value: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
  loan: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
  neutral: "border-border bg-background text-foreground",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
};

export const Chip = ({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONES[tone])}>{children}</span>
);

/** A coloured card with an icon and a short explanation. */
export function Card({ icon: Icon, title, tone = "neutral", children }: { icon: typeof Info; title: string; tone?: Tone; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border p-4 shadow-sm", TONES[tone])}>
      <div className="flex items-center gap-2 text-xs font-semibold"><Icon className="size-4 shrink-0" aria-hidden />{title}</div>
      <div className="mt-2 text-xs leading-relaxed text-foreground/80">{children}</div>
    </div>
  );
}

/** A tip or a warning beside the text. */
export function Callout({ tone = "tip", title, children }: { tone?: "tip" | "warn"; title: string; children: ReactNode }) {
  return (
    <aside className={cn("my-4 max-w-[55rem] rounded-xl border px-4 py-3 text-xs", tone === "tip" ? "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20" : "border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20")}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 leading-relaxed text-foreground/80">{children}</div>
    </aside>
  );
}

/** A figure as the page draws it: label, number, a short line and, when there is one, the change against the stretch before. */
export function MiniTile({ label, value, detail, delta, tone, info }: { label: string; value: string; detail?: string; delta?: { text: string; good: boolean }; tone?: Tone; info?: boolean }) {
  return (
    <div className={cn("flex min-h-[92px] flex-col rounded-lg border px-3 py-2.5", tone ? TONES[tone] : "border-border bg-card")}>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">{label}{info && <Info className="size-3" aria-hidden />}</p>
      <div className="mt-0.5 flex items-start justify-between gap-2">
        <p className="text-xl font-semibold leading-tight tracking-tight tabular-nums">{value}</p>
        {delta && <p className={cn("shrink-0 text-right text-[11px] leading-tight", delta.good ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>{delta.text}<span className="block text-muted-foreground">vs previous</span></p>}
      </div>
      {detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

/** A sketch in a frame, with a caption that is also its accessible description. */
export function Figure({ label, caption, children, wide }: { label: string; caption?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <figure className={cn("mx-auto my-4 w-full rounded-xl border bg-background p-3 shadow-sm", wide ? "max-w-[55rem]" : "max-w-[41.5rem]")} aria-label={label}>
      {children}
      {caption && <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}

const Key = ({ colour, children, line }: { colour: string; children: ReactNode; line?: boolean }) => (
  <span className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("inline-block", line ? "h-0.5 w-4" : "size-2.5 rounded-sm")} style={{ background: colour }} />{children}</span>
);
export { Key };

const GRID = <g stroke="currentColor" strokeOpacity="0.12"><line x1="30" x2="390" y1="25" y2="25" /><line x1="30" x2="390" y1="60" y2="60" /><line x1="30" x2="390" y1="95" y2="95" /></g>;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const monthLabels = (y: number) => MONTHS.map((m, i) => <text key={m} x={55 + i * 58} y={y} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">{m}</text>);

/** What you own above zero, what you owe below it, and net worth as a line. */
export function OwnAndOweSketch() {
  const own = [[40, 18, 14], [42, 18, 15], [44, 20, 15], [47, 20, 16], [48, 22, 17], [52, 22, 18]];
  const owe = [30, 30, 29, 28, 27, 26];
  return (
    <Figure label="Sketch of what you own and owe, month by month" caption={<><Key colour="var(--fi-cash)">Cash &amp; bank</Key><Key colour="var(--fi-invest)">Investments</Key><Key colour="var(--fi-property)">Property</Key><Key colour="var(--fi-loan)">Loans</Key><Key colour="var(--fi-networth)" line>Net worth</Key></>}>
      <svg viewBox="0 0 400 150" className="w-full" role="img" aria-label="Stacked columns of assets above the zero line and loans below it, with a net worth line rising across six months">
        {GRID}
        <line x1="30" x2="390" y1="82" y2="82" stroke="currentColor" strokeOpacity="0.4" />
        {own.map(([cash, inv, prop], i) => {
          const x = 40 + i * 58;
          return <g key={i}><rect x={x} y={82 - cash} width="30" height={cash} fill="var(--fi-cash)" /><rect x={x} y={82 - cash - inv} width="30" height={inv} fill="var(--fi-invest)" /><rect x={x} y={82 - cash - inv - prop} width="30" height={prop} fill="var(--fi-property)" /><rect x={x} y="82" width="30" height={owe[i]} fill="var(--fi-loan)" /></g>;
        })}
        <path d="M55 70 L113 66 L171 62 L229 56 L287 51 L345 44" fill="none" stroke="var(--fi-networth)" strokeWidth="2.5" />
        {monthLabels(145)}
      </svg>
    </Figure>
  );
}

/** A waterfall from one balance to another, with the steps between them. */
export function WaterfallSketch({ steps, label }: { steps: { name: string; value: number; kind: "total" | "up" | "down" | "gap" }[]; label: string }) {
  const width = 360 / steps.length;
  const floor = 20;
  const scale = 0.55;
  // Each step starts where the one before ended; a balance bar starts at the floor and ends at its value.
  const ends: number[] = [];
  steps.forEach((s, i) => ends.push(s.kind === "total" ? s.value : (ends[i - 1] ?? 0) + s.value));
  const bars = steps.map((s, i) => {
    const from = s.kind === "total" ? floor : ends[i - 1] ?? 0;
    const to = ends[i];
    return { ...s, i, top: Math.min(from, to), height: Math.max(3, Math.abs(to - from)) };
  });
  const colour = (k: string) => (k === "total" ? "var(--fi-balance)" : k === "up" ? "var(--fi-up)" : k === "down" ? "var(--fi-down)" : "var(--fi-gap)");
  return (
    <Figure label={label} caption={<><Key colour="var(--fi-balance)">Balance</Key><Key colour="var(--fi-up)">Raises it</Key><Key colour="var(--fi-down)">Lowers it</Key><Key colour="var(--fi-gap)">Unexplained</Key></>}>
      <svg viewBox="0 0 400 120" className="w-full" role="img" aria-label={label}>
        {GRID}
        {bars.map((b) => {
          const x = 35 + b.i * width;
          const y = 112 - (b.top - 0) * scale - b.height * scale;
          return (
            <g key={b.name}>
              <rect x={x + 6} y={y} width={width - 12} height={b.height * scale} rx="2" fill={colour(b.kind)} fillOpacity={b.kind === "gap" ? 0.5 : 0.95} stroke={b.kind === "gap" ? colour(b.kind) : "none"} strokeDasharray={b.kind === "gap" ? "3 2" : undefined} />
              <text x={x + width / 2} y={y - 4} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="currentColor">{b.kind === "total" ? b.value : `${b.value > 0 ? "+" : ""}${b.value}`}</text>
            </g>
          );
        })}
        <line x1="30" x2="390" y1="112" y2="112" stroke="currentColor" strokeOpacity="0.3" />
      </svg>
      <div aria-hidden className="ml-[8.75%] grid w-[90%]" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step) => <span key={step.name} className="px-0.5 text-center text-[10px] leading-tight break-words text-muted-foreground">{step.name}</span>)}
      </div>
      <span className="sr-only">{steps.map((step) => `${step.name}: ${step.value}`).join(", ")}</span>
    </Figure>
  );
}

/** Received above the zero line, spent below it, and what was kept as a dashed line. */
export function FlowSketch() {
  const received = [60, 58, 66, 60, 62, 70];
  const spent = [44, 52, 40, 48, 58, 38];
  const kept = received.map((r, i) => r - spent[i]);
  return (
    <Figure label="Sketch of money in and money out" caption={<><Key colour="var(--fi-income)">Received</Key><Key colour="var(--fi-spend)">Spent</Key><Key colour="var(--fi-kept)" line>Kept (received less spent)</Key></>}>
      <svg viewBox="0 0 400 150" className="w-full" role="img" aria-label="Green bars above the line for what came in, red bars below it for what went out, and a dashed line for what was kept">
        {GRID}
        <line x1="30" x2="390" y1="75" y2="75" stroke="currentColor" strokeOpacity="0.4" />
        {received.map((r, i) => <g key={i}><rect x={42 + i * 58} y={75 - r * 0.9} width="26" height={r * 0.9} rx="3" fill="var(--fi-income)" /><rect x={42 + i * 58} y="75" width="26" height={spent[i] * 0.9} rx="3" fill="var(--fi-spend)" /></g>)}
        <path d={`M55 ${75 - kept[0] * 0.9} ${kept.map((k, i) => `L${55 + i * 58} ${75 - k * 0.9}`).join(" ")}`} fill="none" stroke="var(--fi-kept)" strokeWidth="2" strokeDasharray="5 4" />
        {kept.map((k, i) => <circle key={i} cx={55 + i * 58} cy={75 - k * 0.9} r="3.5" fill="var(--card)" stroke="var(--fi-kept)" strokeWidth="2" />)}
        {monthLabels(145)}
      </svg>
    </Figure>
  );
}

/** Stacked bars by category group, one colour each. */
export function StackedSketch({ label, groups }: { label: string; groups: { name: string; colour: string; values: number[] }[] }) {
  return (
    <Figure label={label} caption={<>{groups.map((g) => <Key key={g.name} colour={g.colour}>{g.name}</Key>)}</>}>
      <svg viewBox="0 0 400 140" className="w-full" role="img" aria-label={label}>
        {GRID}
        {MONTHS.map((_, i) => {
          let y = 115;
          return <g key={i}>{groups.map((g) => { const h = g.values[i]; y -= h; return <rect key={g.name} x={42 + i * 58} y={y} width="26" height={h} fill={g.colour} />; })}</g>;
        })}
        <line x1="30" x2="390" y1="115" y2="115" stroke="currentColor" strokeOpacity="0.3" />
        {monthLabels(133)}
      </svg>
    </Figure>
  );
}

/** A category by month grid: each cell shaded against its own row. */
export function HeatSketch({ rows, symbols = false }: { rows: { name: string; cells: (number | string)[] }[]; symbols?: boolean }) {
  const shade = (v: number | string) => (typeof v === "string" ? "transparent" : v <= -2 ? "var(--fi-below3)" : v === -1 ? "var(--fi-below2)" : v === 0 ? "var(--fi-mid)" : v === 1 ? "var(--fi-above2)" : "var(--fi-above4)");
  return (
    <Figure label="Sketch of the category by month grid" caption={<span>Cooler is below that row’s usual, warmer is above. Neither means good or bad.</span>}>
      <div className="grid gap-px text-[11px]" style={{ gridTemplateColumns: "6.5rem repeat(6, minmax(0, 1fr))" }}>
        <span />{MONTHS.map((m) => <span key={m} className="pb-1 text-center text-muted-foreground">{m}</span>)}
        {rows.map((r) => (
          <div key={r.name} className="contents">
            <span className="truncate py-1 pr-2 text-xs">{r.name}</span>
            {r.cells.map((c, i) => <span key={i} className="rounded px-1 py-1 text-center tabular-nums" style={{ background: shade(c), color: "var(--fi-cell-ink)" }}>{typeof c === "string" ? c : symbols ? (c < 0 ? "▼" : c > 1 ? "▲" : "=") : ""}</span>)}
          </div>
        ))}
      </div>
    </Figure>
  );
}

/** A budget line: spent within the budget (green), the budget not spent (pale) and what went beyond it (red), as in the monthly chart. */
export function BudgetLineSketch() {
  const rows: [string, number, number][] = [["Groceries", 80, 100], ["Dining out", 60, 90], ["Travel", 100, 70]];
  return (
    <Figure label="Sketch of budgeted against spent by group" caption={<><Key colour="var(--fi-up)">Spent within budget</Key><Key colour={BUDGET_TINT}>Budget left</Key><Key colour="var(--fi-other-liability)">Over budget</Key></>}>
      <ul className="space-y-2.5">
        {rows.map(([name, plan, spent]) => {
          const within = Math.min(plan, spent), saved = Math.max(0, plan - spent), extra = Math.max(0, spent - plan);
          return (
            <li key={name} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-xs">
              <span>{name}</span>
              <span className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden><span style={{ width: `${within}%`, background: "var(--fi-up)" }} /><span style={{ width: `${saved}%`, background: BUDGET_TINT }} /><span style={{ width: `${extra}%`, background: "var(--fi-other-liability)" }} /></span>
              <span className={cn("text-right tabular-nums", plan - spent >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>{plan - spent >= 0 ? "+" : "−"}{Math.abs(plan - spent)}</span>
            </li>
          );
        })}
      </ul>
    </Figure>
  );
}

/** Value, the debt against it and the equity left. */
export function EquitySketch() {
  return (
    <Figure label="Sketch of value, debt and equity over time" caption={<><Key colour="var(--fi-property)" line>Asset value</Key><Key colour="var(--fi-loan)" line>Debt against linked assets</Key><Key colour="var(--fi-up)" line>Equity</Key></>}>
      <svg viewBox="0 0 400 140" className="w-full" role="img" aria-label="An asset value line that rises, a debt line that falls and an equity line that rises faster than the value">
        {GRID}
        <path d="M55 60 L113 56 L171 50 L229 44 L287 38 L345 34" fill="none" stroke="var(--fi-property)" strokeWidth="2.5" />
        <path d="M55 80 L113 82 L171 85 L229 90 L287 95 L345 100" fill="none" stroke="var(--fi-loan)" strokeWidth="2.5" />
        <path d="M55 108 L113 104 L171 98 L229 90 L287 82 L345 76" fill="none" stroke="var(--fi-up)" strokeWidth="2.5" />
        {monthLabels(133)}
      </svg>
    </Figure>
  );
}

/** The cash buffer: months of cover on a bar with a goal mark, the real figure and a scenario. */
export function BufferSketch() {
  return (
    <Figure label="Sketch of the cash buffer with a goal and a scenario" wide caption={<span>The real figure is always one step away: pick <b>Actual</b> in the selector.</span>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-[11px] font-medium text-muted-foreground">Actual</p>
          <p className="text-3xl font-semibold tabular-nums">8.8 <span className="text-sm font-normal text-muted-foreground">months</span></p>
          <div className="relative mt-5"><span className="absolute -top-4 right-[8%] -translate-x-0 whitespace-nowrap text-[11px]">your goal: 12 months</span><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: "73%", background: "var(--fi-cash)" }} /></div><span className="absolute -top-1 right-0 h-4 w-0.5 rounded bg-foreground/70" /></div>
          <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">3.2 months short of your 12-month goal</p>
        </div>
        <div className="rounded-lg border border-dashed border-amber-400 bg-amber-50/40 p-3 dark:bg-amber-950/10">
          <p className="inline-flex rounded-full border border-amber-500/60 px-2 text-[11px] text-amber-700 dark:text-amber-400">Simulated: Lean months</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">12.4 <span className="text-sm font-normal text-muted-foreground">months</span></p>
          <p className="text-[11px] text-green-700 dark:text-green-400">▲ +3.6 months against the actual 8.8</p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">3 groups left out · 2 amounts changed</p>
        </div>
      </div>
    </Figure>
  );
}

/** The list of transactions behind a figure, with its check against the figure. */
export function DrillSketch() {
  const rows: [string, string, string, string][] = [["27 Oct", "Checking", "Grocer", "−182.40"], ["24 Oct", "Visa", "Market", "−64.10"], ["19 Oct", "Checking", "Grocer", "−120.00"]];
  return (
    <Figure label="Sketch of the transactions behind a figure" wide>
      <div className="overflow-hidden rounded-lg border text-xs">
        <div className="border-b bg-muted/30 px-3 py-2 font-semibold">Food · Oct 2026 <span className="font-normal text-muted-foreground">Spending in this category, refunds included</span></div>
        <table className="w-full border-collapse"><tbody>{rows.map((r) => <tr key={r[0] + r[3]} className="border-b border-border/60 last:border-b-0"><td className="px-3 py-1.5 text-muted-foreground">{r[0]}</td><td className="px-3 py-1.5">{r[1]}</td><td className="px-3 py-1.5">{r[2]}</td><td className="px-3 py-1.5 text-right tabular-nums">{r[3]}</td></tr>)}</tbody></table>
        <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2"><span><b>3</b> matches · −366.50</span><span className="text-green-700 dark:text-green-400">✓ Matches the figure (−366.50)</span></div>
      </div>
    </Figure>
  );
}

/** An account, the class it has and how it counts. */
export function ReadinessSketch() {
  const rows: [string, string, string, Tone][] = [["Everyday", "Cash & bank", "Counts as cash", "income"], ["Brokerage", "Investment", "Investment", "value"], ["Mortgage", "Loan", "Loan liability", "loan"], ["Old card", "Needs a class", "Not set", "warn"]];
  return (
    <Figure label="Sketch of how each account is understood before any figure appears" wide>
      <div className="grid gap-px overflow-hidden rounded-lg border bg-border text-xs sm:grid-cols-[1fr_1fr_1fr]">
        {["Account", "Class", "How it counts"].map((h) => <span key={h} className="bg-muted/40 px-3 py-1.5 font-semibold">{h}</span>)}
        {rows.map(([a, c, t, tone]) => <div key={a} className="contents"><span className="bg-background px-3 py-1.5">{a}</span><span className="bg-background px-3 py-1.5"><Chip tone={tone === "warn" ? "warn" : "neutral"}>{c}</Chip></span><span className="bg-background px-3 py-1.5"><Chip tone={tone}>{t}</Chip></span></div>)}
      </div>
    </Figure>
  );
}

const PipelineBox =({ title, lines, tone }: { title: string; lines: string[]; tone: Tone }) => (
  <div className={cn("flex-1 rounded-xl border p-3", TONES[tone])}><p className="text-xs font-semibold">{title}</p><ul className="mt-1.5 space-y-1 text-[11px] text-foreground/80">{lines.map((l) => <li key={l}>• {l}</li>)}</ul></div>
);

/** What Bench adds to the transactions in Actual. */
export function PipelineSketch() {
  return (
    <Figure label="What Financial Insights adds to the transactions in Actual" wide>
      <div className="flex flex-wrap items-stretch gap-3">
        <PipelineBox tone="neutral" title="In Actual" lines={["Transactions, payees, categories", "Account balances", "Budget months"]} />
        <span aria-hidden className="self-center text-lg text-muted-foreground">+</span>
        <PipelineBox tone="value" title="Kept by Bench" lines={["Account class and how it counts", "Asset values, sales and loan links", "Loan schedules and card interest", "Your goal and scenarios"]} />
        <span aria-hidden className="self-center text-lg text-muted-foreground">=</span>
        <PipelineBox tone="income" title="On this page" lines={["Net worth explained step by step", "Cash that reconciles", "Months of cover, with what-ifs", "Every figure opens its transactions"]} />
      </div>
    </Figure>
  );
}
