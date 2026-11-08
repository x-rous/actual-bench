"use client";

import { BookOpen, ClipboardCheck, Layers, Network, Scale, type LucideIcon } from "lucide-react";
import { GuideFrame } from "@/components/ui/guide-frame";
import { Example, Heading, Para, Steps } from "@/components/ui/guide-primitives";
import { Callout, Card } from "@/features/financial-insights/components/guide/guideVisuals";
import { ClassMap, InheritanceSketch, ModuleMap, ReadinessSketch, SameBalanceSketch, TreatmentTable } from "./accountsGuideVisuals";

/** The Accounts guide: what a class and Financial Reporting are, what they mean for each account, and why the rest of the app needs them. */
export type AccountsGuideSection = "start" | "classes" | "reporting" | "matters" | "ready";

export const ACCOUNTS_GUIDE_SECTIONS: [AccountsGuideSection, string][] = [
  ["start", "Start here"], ["classes", "Account classes"], ["reporting", "Financial Reporting"], ["matters", "Why it matters and where it is used"], ["ready", "Getting every account ready"],
];

const SECTION_ICONS: Record<AccountsGuideSection, LucideIcon> = { start: BookOpen, classes: Layers, reporting: Scale, matters: Network, ready: ClipboardCheck };

const Grid = ({ cols = 3, children }: { cols?: 2 | 3; children: React.ReactNode }) => <div className={`grid max-w-[55rem] gap-3 ${cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>{children}</div>;

export function AccountsGuide({ section, onSection, onClose, docsUrl }: { section: AccountsGuideSection; onSection: (section: AccountsGuideSection) => void; onClose: () => void; docsUrl?: string }) {
  const link = (to: AccountsGuideSection, text: string) => <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSection(to)}>{text}</button>;
  return (
    <GuideFrame title="Accounts guide" description="What an account class and Financial Reporting are, why they matter, and where Bench uses them." docsUrl={docsUrl}
      sections={ACCOUNTS_GUIDE_SECTIONS} icons={SECTION_ICONS} section={section} onSection={onSection} onClose={onClose}>

      {section === "start" && <>
        <Para>Actual knows an account’s name, its balance and whether it is on or off budget. It does not know what the account <b>is</b>: money you can spend today, a house, a pension, a mortgage. Two columns on this page tell Bench, so every other page can treat your money correctly.</Para>
        <Grid cols={2}>
          <Card icon={Layers} tone="value" title="Class">What kind of account it is: Cash, Bank, Property, Investment, Credit Card, Loan and so on. Set on the account, or once on a group. See {link("classes", "Account classes")}.</Card>
          <Card icon={Scale} tone="income" title="Financial Reporting">How the account counts: as cash, a fixed deposit, a fixed asset, a loan. Most classes decide it for you; two let you pick, and nothing is required. See {link("reporting", "Financial Reporting")}.</Card>
        </Grid>
        <Heading>Set up in three steps</Heading>
        <Steps items={[
          ["Give every account a class", "Pick it in the Class column, or set it once on an account group and let its accounts inherit it. An account with none shows as Unclassified."],
          ["Check each account’s placement", "A credit card must be on budget; a house, car, investment, pension or loan must be off budget. An off-budget account you do not want counted can be left out with Include in Financial Insights, and then needs no class."],
          ["Open Financial Insights", "When every account is understood it unlocks. Until then it lists what is missing."],
        ]} />
        <Callout title="Nothing here changes Actual">A class, a Financial Reporting choice and the account settings are Bench’s own notes about an account. They never change Actual’s balances, transactions, budget mode, transfers or the account’s own type. They are kept in Bench’s database for this budget.</Callout>
      </>}

      {section === "classes" && <>
        <Para>There are ten classes: seven for what you own and three for what you owe. An account you want Bench to ignore is not a class: turn off Include in Financial Insights for it instead.</Para>
        <ClassMap />
        <Heading>On budget or off budget</Heading>
        <Para>Some classes only make sense off budget: a house, a car, an investment, a pension, a loan are balances that live outside your day-to-day spending. The Class dropdown lists them under <b>Off-budget accounts only</b>, disabled, for an on-budget account. Credit Card is the other way round: it is listed under <b>On-budget accounts only</b> for an off-budget account, because a card’s purchases must count as spending. Cash, Bank, Other Asset and Other Liability work either way. Moving an account to a placement its class does not accept is blocked, so the two never disagree.</Para>
        <Heading>Classes on a group</Heading>
        <InheritanceSketch />
        <Para>Set a class on an <b>account group</b> (Manage Groups) and every account in it inherits it. An inherited class is shown read-only with an <i>Inherited</i> tag; change it on the group. A group’s class wins over an account’s own, which stays stored but unused while the account is in that group.</Para>
        <Heading>Include in Financial Insights</Heading>
        <Para>An off-budget tracking account that must not contribute to Financial Insights at all, such as a scratch account, can be switched off with <b>Include in Financial Insights</b> (the settings button in the Financial Reporting column, or on a group in Manage Groups). It then needs no class. Its balance, entries and transfers are left out. Money moved between an included and an excluded account changes your net worth, so it appears on its own line, <i>Transfers with excluded accounts</i>, and is never income, spending or in transit. On-budget accounts cannot be left out, because their entries are part of your budget.</Para>
      </>}

      {section === "reporting" && <>
        <Para>Financial Reporting says how an account counts next to its class. Most classes answer it themselves; Bank and Other Asset let you pick, and a few yes/no settings can be turned on. Nothing is required.</Para>
        <TreatmentTable />
        <Grid>
          <Card icon={Scale} tone="income" title="A default, and an alternative">Bank counts as cash and cash equivalents unless you mark it a <b>Fixed / restricted deposit</b>: still an asset in net worth, but not cash and not part of the cash buffer.</Card>
          <Card icon={Scale} tone="warn" title="Optional settings">Other Asset is a <b>Holding</b> unless you mark it <b>Accessible money</b> or a <b>Fixed asset</b> (not both). Investment can be marked <b>Accessible money</b>: the cash buffer then shows a second figure that includes it. An off-budget Cash or Bank account can treat uncategorized money in, such as interest, as income. Any off-budget account can be left out of Financial Insights.</Card>
          <Card icon={Scale} tone="kept" title="Fixed by the class">Cash, Vehicle, Property, Investment, Retirement, Credit Card, Loan and Other Liability show their label as plain text. There is nothing to pick.</Card>
        </Grid>
        <Heading>Fixed asset</Heading>
        <Para>A <b>Fixed asset</b> is a tangible thing you hold and revalue or depreciate, such as gold or a collectible. It is the only Other Asset treatment the Assets module accepts. An Other Asset that is not marked as a fixed asset is a <b>Holding</b>, such as money owed to you.</Para>
        <Callout title="Choices are saved straight away">Both are Bench’s own notes, so on a saved account a change applies at once and is not part of the draft you Save to Actual. A choice belongs to its class: if you change the class, a choice the new class does not accept is ignored and asked for again. A new account that is not saved yet reads <i>Save the account to choose</i>.</Callout>
      </>}

      {section === "matters" && <>
        <Para>The same balance means different things depending on what the account is. Without a class, Bench would have to guess, and a guess shows up as a wrong net worth or a wrong cash buffer.</Para>
        <SameBalanceSketch />
        <Grid>
          <Card icon={Scale} tone="value" title="A true net worth">Assets add and liabilities subtract, each group on its own line, so you see what you own, what you owe and what is left.</Card>
          <Card icon={Scale} tone="income" title="Cash is only cash">Investments, fixed deposits and property are real wealth, but they are not what you can spend next month. Only Cash and Bank count toward the cash buffer.</Card>
          <Card icon={Scale} tone="spend" title="Nothing counted twice">Moving money to an investment or a loan is not spending, a card payment is not a second purchase, and an account left out of Financial Insights does not leak in.</Card>
        </Grid>
        <Heading>Where it is used</Heading>
        <ModuleMap />
        <Callout title="Why not Actual’s own account type?">Actual keeps a type and subtype on accounts for bank sync. They do not say whether a balance is cash, a fixed deposit or a long-term holding, and they cannot be set on a group. A class and Financial Reporting are Bench’s own, and never change Actual’s.</Callout>
      </>}

      {section === "ready" && <>
        <Para>Financial Insights shows no figure until every account is understood, so a number is never built on a guess. This is what it checks.</Para>
        <ReadinessSketch />
        <Steps items={[
          ["A class", "Its own or its group’s. An account with none needs a class."],
          ["A valid place", "A class that needs off-budget cannot sit on an on-budget account, and a credit card cannot sit on an off-budget one. An account left out of Financial Insights must be off budget."],
          ["Nothing else", "No Financial Reporting choice is required: the choices and settings are all optional."],
          ["Closed accounts", "A closed account with no transactions and a zero balance needs nothing. One with history must be classified."],
        ]} />
        <Heading>Doing it quickly</Heading>
        <Grid>
          <Card icon={Layers} tone="value" title="Use groups">Set the class once on a group and every member inherits it, including accounts added later.</Card>
          <Card icon={Layers} tone="income" title="Select several">Select rows and set the class for all of them at once. Optional choices are made in the Financial Reporting column.</Card>
          <Card icon={Layers} tone="warn" title="Follow the attention list">The table counts accounts that are unclassified, and can filter to just those or to the accounts left out of Financial Insights.</Card>
        </Grid>
        <Para>When you return to Financial Insights it checks again by itself. If a new unclassified account appears later, the page locks again and removes its figures until it is classified.</Para>
        <Heading>Common questions</Heading>
        <Example caption="Questions" head={["Question", "Answer"]} rows={[
          ["Can I change a class later?", "Yes. Figures that use it update the next time you open the page."],
          ["Why can’t I pick Investment for an on-budget account?", "Investment, Retirement, Property, Vehicle and Loan are off-budget only (Credit Card is on-budget only). Move the account off budget first, or choose a class that works on budget."],
          ["Why is the Financial Reporting cell just text?", "The class already decides it, so there is nothing to choose."],
          ["Is a savings account cash?", "Yes, as a Bank account, unless you mark it a fixed / restricted deposit."],
          ["Where are my choices kept?", "In Bench’s own database for this budget, not in your budget file."],
        ]} />
      </>}
    </GuideFrame>
  );
}
