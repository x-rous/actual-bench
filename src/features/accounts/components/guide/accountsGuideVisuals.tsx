import type { ReactNode } from "react";
import { ACCOUNT_CLASS_INFO, accountClassRequiresOffBudget, type AccountClass } from "@/lib/account-class";
import { REPORTING_LABELS, reportingRequirement } from "@/lib/account-class/reporting";
import { Chip, Figure, Key, type Tone } from "@/features/financial-insights/components/guide/guideVisuals";
import { ACCOUNT_CLASS_ICONS } from "../../lib/accountClassIcons";

/**
 * The pictures of the Accounts guide. They are built from the real class and treatment definitions, so the guide cannot drift from
 * what the Class and Financial Reporting columns offer.
 */

const SIDE_TITLE = { asset: "Assets: what you own", liability: "Liabilities: what you owe", none: "Not reported" } as const;

/** Every class, grouped as the Class dropdown groups them, with where it may sit. */
export function ClassMap() {
  return (
    <Figure wide label="The account classes" caption={<span>A class marked <b>off-budget only</b> cannot be given to an on-budget account.</span>}>
      <div className="grid gap-3 md:grid-cols-3">
        {(["asset", "liability", "none"] as const).map((side) => (
          <div key={side} className="rounded-lg border bg-card p-2.5">
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">{SIDE_TITLE[side]}</p>
            <ul className="space-y-1.5">
              {ACCOUNT_CLASS_INFO.filter((c) => c.side === side).map((c) => {
                const Icon = ACCOUNT_CLASS_ICONS[c.value];
                return (
                  <li key={c.value} className="flex items-start gap-2 text-xs">
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0"><b>{c.label}</b>{accountClassRequiresOffBudget(c.value) && <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">off-budget only</span>}<span className="block text-[11px] text-muted-foreground">{c.description}</span></span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Figure>
  );
}

/**
 * What the Financial Reporting column shows for each class: what it counts as, and what else you may pick. A class with a default
 * and an alternative shows both, the default in green; a class that asks shows the choices in amber; the rest have one fixed answer.
 */
export function TreatmentTable() {
  return (
    <Figure wide label="Financial Reporting for each class" caption={<><Key colour="#16a34a">Default</Key><Key colour="#94a3b8">Optional, if you pick it</Key><Key colour="#f59e0b">You must choose</Key><Key colour="#cbd5e1">Fixed: nothing to pick</Key></>}>
      <div className="overflow-hidden rounded-lg border text-xs">
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-px bg-border">
          {["Class", "Counts as", "Other choices"].map((h) => <span key={h} className="bg-muted/40 px-3 py-1.5 text-[11px] font-semibold">{h}</span>)}
          {ACCOUNT_CLASS_INFO.map((c) => {
            const r = reportingRequirement(c.value as AccountClass);
            const counts: ReactNode = r.kind === "required" ? <Chip tone="warn">Choose…</Chip> : <Chip tone={r.kind === "bank-default" ? "income" : "neutral"}>{r.label}{r.kind === "bank-default" ? " · default" : ""}</Chip>;
            const others: ReactNode = r.kind === "required"
              ? <span className="flex flex-wrap items-center gap-1">{r.options.map((o) => <Chip key={o} tone="warn">{REPORTING_LABELS[o]}</Chip>)}</span>
              : r.kind === "bank-default" ? <Chip>{REPORTING_LABELS["fixed-deposit"]}</Chip> : <span className="text-muted-foreground">None</span>;
            return (
              <div key={c.value} className="contents">
                <span className="self-stretch bg-background px-3 py-2 font-medium">{c.label}</span>
                <span className="self-stretch bg-background px-3 py-1.5">{counts}</span>
                <span className="self-stretch bg-background px-3 py-1.5">{others}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Figure>
  );
}

const InheritedRow = ({ name, cls, inherited }: { name: string; cls: string; inherited?: boolean }) => (
  <li className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-1.5 text-xs"><span>{name}</span><span className="flex items-center gap-1.5">{cls}{inherited && <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">Inherited</span>}</span></li>
);

/** A group's class is inherited by its accounts. */
export function InheritanceSketch() {
  return (
    <Figure wide label="A group's class is inherited by its accounts" caption={<span>Change the class on the <b>group</b>; its accounts follow. An account outside a group (or in a group with no class) keeps its own.</span>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-2.5"><p className="mb-2 text-xs font-semibold">Group “Savings &amp; investments” <Chip tone="value">Investment</Chip></p><ul className="space-y-1.5"><InheritedRow name="Brokerage" cls="Investment" inherited /><InheritedRow name="Index fund" cls="Investment" inherited /></ul></div>
        <div className="rounded-lg border bg-card p-2.5"><p className="mb-2 text-xs font-semibold">No group</p><ul className="space-y-1.5"><InheritedRow name="Everyday" cls="Bank" /><InheritedRow name="Visa" cls="Credit Card" /></ul></div>
      </div>
    </Figure>
  );
}

/** One balance, read four ways. */
export function SameBalanceSketch() {
  const rows: [string, string, string, Tone][] = [
    ["Bank", "50,000", "Cash. In net worth and in your cash buffer. A transfer in or out is not income or spending.", "income"],
    ["Bank · fixed / restricted deposit", "50,000", "Still an asset in net worth, but not cash: it does not count toward your cash buffer.", "kept"],
    ["Investment · non-current", "50,000", "Shown on the Investments tab. Price changes are investment activity, not income. Not cash.", "value"],
    ["Loan", "−50,000", "A debt. Shown on Loans & cards. Principal repaid is not spending; interest and fees are.", "loan"],
  ];
  return (
    <Figure wide label="The same balance, read four ways">
      <div className="overflow-hidden rounded-lg border text-xs">
        <div className="grid grid-cols-[13.5rem_5.5rem_minmax(0,1fr)] items-center gap-px bg-border">
          {["The account is a…", "Balance", "How Bench reads it"].map((h, i) => <span key={h} className={`bg-muted/40 px-3 py-1.5 text-[11px] font-semibold ${i === 1 ? "text-right" : ""}`}>{h}</span>)}
          {rows.map(([cls, amount, meaning, tone]) => (
            <div key={cls} className="contents">
              <span className="self-stretch bg-background px-3 py-2"><Chip tone={tone}>{cls}</Chip></span>
              <span className="self-stretch bg-background px-3 py-2 text-right font-semibold tabular-nums">{amount}</span>
              <span className="self-stretch bg-background px-3 py-2 text-muted-foreground">{meaning}</span>
            </div>
          ))}
        </div>
      </div>
    </Figure>
  );
}

const Module = ({ name, classes, uses, unset }: { name: string; classes: string[]; uses: ReactNode; unset: ReactNode }) => (
  <div className="grid gap-x-4 gap-y-1.5 bg-background px-3 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
    <span className="font-semibold">{name}</span>
    <span className="space-y-1.5">
      <span className="flex flex-wrap gap-1">{classes.map((c) => <Chip key={c}>{c}</Chip>)}</span>
      <span className="block">{uses}</span>
      <span className="block text-muted-foreground"><b className="font-medium text-foreground/80">If not set: </b>{unset}</span>
    </span>
  </div>
);

/** Which page or module of the app reads which classes, what it does with them and what happens without them. */
export function ModuleMap() {
  return (
    <Figure wide label="Where classes and Financial Reporting are used">
      <div className="overflow-hidden rounded-lg border text-xs">
        <div className="divide-y divide-border">
          <Module name="Financial Insights" classes={["Every class"]}
            uses="Builds net worth and every tab from them. Financial Reporting tells cash from a fixed deposit and current from non-current: only Cash and Bank count toward the cash buffer, and a fixed / restricted deposit does not."
            unset="The page stays locked and lists the accounts that are missing a class or a choice." />
          <Module name="Assets" classes={["Property", "Vehicle", "Other Asset (Fixed asset)"]}
            uses="An asset’s ledger account must hold a class of that kind. Investments are not assets here."
            unset="An Other Asset marked current or non-current is not a fixed asset: Assets and Financial Insights flag the mismatch and ask you to review it." />
          <Module name="Credit Cards" classes={["Credit Card"]}
            uses="The cards listed are your open, on-budget accounts of class Credit Card."
            unset="An account that is not a Credit Card is not listed as a card." />
          <Module name="Bank Reconciliation" classes={["Credit Card"]}
            uses="A credit card account is recognised by its class."
            unset="It is treated like any other account." />
        </div>
      </div>
    </Figure>
  );
}

/** The path from a new account to figures on the page. */
export function ReadinessSketch() {
  const steps: [string, string, Tone][] = [["1", "Class", "value"], ["2", "Choice, if the class asks", "warn"], ["3", "Ready", "income"], ["4", "Financial Insights shows figures", "income"]];
  return (
    <Figure wide label="From a new account to figures on the page">
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {steps.map(([n, text, tone], i) => (
          <li key={n} className="flex items-center gap-2"><Chip tone={tone}><b className="mr-1.5">{n}</b>{text}</Chip>{i < steps.length - 1 && <span aria-hidden className="text-muted-foreground">→</span>}</li>
        ))}
      </ol>
    </Figure>
  );
}
