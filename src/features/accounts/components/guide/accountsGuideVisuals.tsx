import type { ReactNode } from "react";
import { ACCOUNT_CLASS_HEADINGS, ACCOUNT_CLASS_INFO, accountClassRequiresOffBudget, accountClassRequiresOnBudget, type AccountClass } from "@/lib/account-class";
import { ACCESS_LABEL, classHasAccess, defaultAccess, rungOf } from "@/lib/account-class/access";
import { Chip, Figure, Key, type Tone } from "@/features/financial-insights/components/guide/guideVisuals";
import { ACCOUNT_CLASS_ICONS } from "../../lib/accountClassIcons";

/**
 * The pictures of the Accounts guide. They are built from the real class and access definitions, so the guide cannot drift from what
 * the Class and Accessible columns offer.
 */

/** Every class, under the headings the Class dropdown uses, with where it may sit. */
export function ClassMap() {
  return (
    <Figure wide label="The account classes" caption={<span>A class marked <b>off-budget only</b> cannot be given to an on-budget account, and <b>on-budget only</b> the other way round.</span>}>
      <div className="grid gap-3 md:grid-cols-3">
        {ACCOUNT_CLASS_HEADINGS.map((heading) => (
          <div key={heading} className="rounded-lg border bg-card p-2.5">
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">{heading}</p>
            <ul className="space-y-1.5">
              {ACCOUNT_CLASS_INFO.filter((c) => c.heading === heading).map((c) => {
                const Icon = ACCOUNT_CLASS_ICONS[c.value];
                return (
                  <li key={c.value} className="flex items-start gap-2 text-xs">
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0"><b>{c.label}</b>{accountClassRequiresOffBudget(c.value) && <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">off-budget only</span>}{accountClassRequiresOnBudget(c.value) && <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">on-budget only</span>}<span className="block text-[11px] text-muted-foreground">{c.description}</span></span>
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

/** What a class counts as when you can use its money now, in the words the guide uses. */
const COUNTS_AS: Record<ReturnType<typeof rungOf>, string> = {
  cash: "Cash", savings: "Savings you can use", reachable: "Other money you can reach", locked: "Locked money", owned: "A thing you own", card: "Owed amount comes off cash", debt: "A debt",
};

/**
 * What the Accessible column shows for each class: its default off budget, and whether you can change it. On budget, every class that
 * has access is available now.
 */
export function AccessTable() {
  return (
    <Figure wide label="Accessible, for each class" caption={<><Key colour="#16a34a">Available now by default</Key><Key colour="#94a3b8">Locked by default</Key><Key colour="#cbd5e1">No access: nothing to pick</Key></>}>
      <div className="overflow-hidden rounded-lg border text-xs">
        <table className="w-full border-collapse">
          <thead className="bg-muted/40 text-left text-[11px]">
            <tr>{["Class", "Off budget, by default", "Counts as"].map((h) => <th key={h} scope="col" className="border-b px-3 py-1.5 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {ACCOUNT_CLASS_INFO.map((c) => {
              const value = c.value as AccountClass;
              const access = defaultAccess(value, true);
              const tone: Tone = access === "available" ? "income" : access === "locked" ? "kept" : "neutral";
              const cell: ReactNode = classHasAccess(value)
                ? <span className="flex flex-wrap items-center gap-1"><Chip tone={tone}>{ACCESS_LABEL[access!]}</Chip><span className="text-muted-foreground">you can change it</span></span>
                : <span className="text-muted-foreground">Nothing to choose</span>;
              const counts = classHasAccess(value)
                ? `${COUNTS_AS[rungOf(value, "available")]} when available; ${COUNTS_AS.locked.toLowerCase()} when locked`
                : COUNTS_AS[rungOf(value, null)];
              return (
                <tr key={c.value} className="border-b last:border-0">
                  <th scope="row" className="w-36 px-3 py-2 text-left font-medium">{c.label}</th>
                  <td className="px-3 py-1.5">{cell}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{counts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
        <div className="rounded-lg border bg-card p-2.5"><p className="mb-2 text-xs font-semibold">No group</p><ul className="space-y-1.5"><InheritedRow name="Everyday" cls="Checking" /><InheritedRow name="Visa" cls="Credit Card" /></ul></div>
      </div>
    </Figure>
  );
}

/** One balance, read four ways. */
export function SameBalanceSketch() {
  const rows: [string, string, string, Tone][] = [
    ["Savings · available now", "50,000", "Savings you can use. In net worth, and in cash when Financial Insights counts cash and savings (the default). A transfer in or out is not income or spending.", "income"],
    ["Fixed Deposit · locked", "50,000", "Still an asset in net worth, but locked: it does not count toward cash or your cash buffer.", "kept"],
    ["Investment", "50,000", "Shown on the Investments tab. Price changes are investment activity, not income. Locked unless you mark it Available now, which counts it in the cash buffer’s second figure.", "value"],
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
    <Figure wide label="Where classes and access are used">
      <div className="overflow-hidden rounded-lg border text-xs">
        <div className="divide-y divide-border">
          <Module name="Financial Insights" classes={["Every class"]}
            uses="Builds net worth and every tab from them. Access tells money you can use now from locked money: only Checking, Cash, Savings and Fixed Deposits you can use now count as cash, and other money you can reach is the cash buffer’s second figure."
            unset="The page stays locked and lists the accounts that are missing a class or sit in a placement their class does not accept." />
          <Module name="Assets" classes={["Property", "Vehicle", "Other Fixed Asset"]}
            uses="An asset’s ledger account must be off budget and hold a class of that kind. Investments are not assets here."
            unset="An Other Asset (money owed to you, a deposit paid) is not a fixed asset: Assets and Financial Insights flag an asset whose account has that class and ask you to review it." />
          <Module name="Cashflow Planning" classes={["Every class"]}
            uses="A plan's automatic cash, savings and outside roles follow the class and access: Checking and Cash you can use now are cash; savings and investments are tracked beside it, split into what you can use and what is locked."
            unset="An on-budget account without a class counts as cash; an off-budget one is outside the plan." />
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
  const steps: [string, string, Tone][] = [["1", "Class", "value"], ["2", "Accessible, if the default is not right", "warn"], ["3", "Ready", "income"], ["4", "Financial Insights shows figures", "income"]];
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
