"use client";

import { BookOpen, ClipboardCheck, KeyRound, Layers, Network, Scale, type LucideIcon } from "lucide-react";
import { GuideFrame } from "@/components/ui/guide-frame";
import { Example, Heading, Para, Steps } from "@/components/ui/guide-primitives";
import { Callout, Card } from "@/features/financial-insights/components/guide/guideVisuals";
import { AccessTable, ClassMap, InheritanceSketch, ModuleMap, ReadinessSketch, SameBalanceSketch } from "./accountsGuideVisuals";

/** The Accounts guide: what a class and access are, what they mean for each account, and why the rest of the app needs them. */
export type AccountsGuideSection = "start" | "classes" | "access" | "matters" | "ready";

export const ACCOUNTS_GUIDE_SECTIONS: [AccountsGuideSection, string][] = [
  ["start", "Start here"], ["classes", "Account classes"], ["access", "Accessible and reports"], ["matters", "Why it matters and where it is used"], ["ready", "Getting every account ready"],
];

const SECTION_ICONS: Record<AccountsGuideSection, LucideIcon> = { start: BookOpen, classes: Layers, access: KeyRound, matters: Network, ready: ClipboardCheck };

const Grid = ({ cols = 3, children }: { cols?: 2 | 3; children: React.ReactNode }) => <div className={`grid max-w-[55rem] gap-3 ${cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>{children}</div>;

export function AccountsGuide({ section, onSection, onClose, docsUrl }: { section: AccountsGuideSection; onSection: (section: AccountsGuideSection) => void; onClose: () => void; docsUrl?: string }) {
  const link = (to: AccountsGuideSection, text: string) => <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSection(to)}>{text}</button>;
  return (
    <GuideFrame title="Accounts guide" description="What an account class and access are, why they matter, and where Bench uses them." docsUrl={docsUrl}
      sections={ACCOUNTS_GUIDE_SECTIONS} icons={SECTION_ICONS} section={section} onSection={onSection} onClose={onClose}>

      {section === "start" && <>
        <Para>Actual knows an account’s name, its balance and whether it is on or off budget. It does not know what the account <b>is</b>, or whether you could use its money today: a savings account you can withdraw from, a term deposit you cannot, a house, a pension, a mortgage. Two questions on this page tell Bench, so every other page can treat your money correctly.</Para>
        <Grid cols={2}>
          <Card icon={Layers} tone="value" title="What is it? (Class)">Checking, Savings, Fixed Deposit, Investment, Property, Credit Card, Loan and so on. Set on the account, or once on a group. See {link("classes", "Account classes")}.</Card>
          <Card icon={KeyRound} tone="income" title="Can you use it now? (Accessible)">Available now or Locked. On budget, an account is always available; off budget it follows its class unless you choose. See {link("access", "Accessible and reports")}.</Card>
        </Grid>
        <Heading>Set up in three steps</Heading>
        <Steps items={[
          ["Give every account a class", "Pick it in the Class column, or set it once on an account group and let its accounts inherit it. An account with none shows as Unclassified."],
          ["Check access and placement", "Off budget, change Accessible where the class default is not right: a notice account you cannot touch is Locked, a fund you can sell today is Available now. A credit card must be on budget; a house, car, fixed deposit, investment, pension or loan must be off budget."],
          ["Open Financial Insights", "When every account is understood it unlocks. Until then it lists what is missing."],
        ]} />
        <Callout title="Nothing here changes Actual">A class, an access choice and leaving an account out of reports are Bench’s own notes about an account. They never change Actual’s balances, transactions, budget mode, transfers or the account’s own type. They are kept in Bench’s database for this budget.</Callout>
      </>}

      {section === "classes" && <>
        <Para>There are thirteen classes, under six headings: everyday money, savings, credit, investments, things you own and debts. An account you want Bench to ignore is not a class: leave it out of reports instead.</Para>
        <ClassMap />
        <Heading>On budget or off budget</Heading>
        <Para>On budget means money you budget with, so you can use it. Some classes only make sense off budget: a fixed deposit is locked money, and a house, a car, another fixed asset, an investment, a pension or a loan are balances that live outside your day-to-day spending. The Class dropdown lists them under <b>Off-budget accounts only</b>, disabled, for an on-budget account. Credit Card is the other way round, because a card’s purchases must count as spending. Checking, Cash, Savings, Other Asset and Other Liability work either way. Moving an account to a placement its class does not accept is blocked, so the two never disagree.</Para>
        <Heading>Savings, fixed deposits and other assets</Heading>
        <Para><b>Savings</b> is money set aside in a savings, high-yield, money market or notice account. <b>Fixed Deposit</b> is a term deposit, a CD, or a restricted or pledged deposit. <b>Other Fixed Asset</b> is a thing you own and value in Assets, such as gold, a collectible or equipment. <b>Other Asset</b> is anything else you hold that is not money in a bank, such as money owed to you or a rental bond.</Para>
        <Heading>Classes on a group</Heading>
        <InheritanceSketch />
        <Para>Set a class on an <b>account group</b> (Manage Groups) and every account in it inherits it. An inherited class is shown read-only with an <i>Inherited</i> tag; change it on the group. A group’s class wins over an account’s own, which stays stored but unused while the account is in that group.</Para>
      </>}

      {section === "access" && <>
        <Para>The <b>Accessible</b> column answers one question: could you use this money now if you needed it? An on-budget account always can, because Actual lets you assign its money. Off budget, each class has a default, and you can change it.</Para>
        <AccessTable />
        <Grid>
          <Card icon={KeyRound} tone="income" title="Available now">Checking, Cash and Savings are available by default. Mark a Fixed Deposit, Investment, Retirement or Other Asset account <b>Available now</b> when you could use it within days, such as a no-penalty CD or a money market fund.</Card>
          <Card icon={KeyRound} tone="kept" title="Locked">Fixed Deposits, investments, retirement accounts and other assets are locked by default. Mark a Savings or Checking account <b>Locked</b> when you cannot reach it, such as a notice account or a frozen account.</Card>
          <Card icon={Scale} tone="value" title="What it changes">Cash in Financial Insights counts Checking and Cash you can use now, and with savings (the default) also Savings and Fixed Deposits you can use now. Investments, retirement and other assets you can use now are the cash buffer’s second figure. Locked money stays in net worth only.</Card>
        </Grid>
        <Heading>Interest in off-budget savings</Heading>
        <Para>Actual gives entries in off-budget accounts no category. In an off-budget <b>Savings</b> or <b>Fixed Deposit</b> account, money in without a category is counted as income (interest, in practice); money out stays an unidentified movement.</Para>
        <Heading>Leave out of reports</Heading>
        <Para>An off-budget tracking account that must not count at all, such as a scratch account, can be left out with the button in the <b>Reports</b> column, or on a group in Manage Groups. It then needs no class, and Financial Insights and Cashflow leave out its balance, entries and transfers. Money moved between an included and an excluded account changes your net worth, so it appears on its own line, <i>Transfers with excluded accounts</i>, and is never income, spending or in transit. On-budget accounts cannot be left out, because their entries are part of your budget.</Para>
        <Callout title="Choices are saved straight away">They are Bench’s own notes, so on a saved account a change applies at once and is not part of the draft you Save to Actual. A choice that no longer applies (the account moved on budget, or its class has no access) is kept and comes back if the account changes back. A new account’s choices are staged with it, in the table or the New Account drawer, and saved once it exists. Several accounts can be set at once with Set access… in the selection bar.</Callout>
      </>}

      {section === "matters" && <>
        <Para>The same balance means different things depending on what the account is and whether you can use it. Without a class, Bench would have to guess, and a guess shows up as a wrong net worth or a wrong cash buffer.</Para>
        <SameBalanceSketch />
        <Grid>
          <Card icon={Scale} tone="value" title="A true net worth">Assets add and liabilities subtract, each class on its own line, so you see what you own, what you owe and what is left.</Card>
          <Card icon={Scale} tone="income" title="Cash is money you can use">Locked deposits, investments and property are real wealth, but they are not what you can spend next month. Only Checking, Cash, Savings and Fixed Deposits you can use now count as cash.</Card>
          <Card icon={Scale} tone="spend" title="Nothing counted twice">Moving money to savings, an investment or a loan is not spending, a card payment is not a second purchase, and an account left out of reports does not leak in.</Card>
        </Grid>
        <Heading>Where it is used</Heading>
        <ModuleMap />
        <Callout title="Why not Actual’s own account type?">Actual keeps a type and subtype on accounts for bank sync. They do not say whether a balance is money you can use, a fixed deposit or a long-term holding, and they cannot be set on a group. A class and access are Bench’s own, and never change Actual’s.</Callout>
      </>}

      {section === "ready" && <>
        <Para>Financial Insights shows no figure until every account is understood, so a number is never built on a guess. This is what it checks.</Para>
        <ReadinessSketch />
        <Steps items={[
          ["A class", "Its own or its group’s. An account with none needs a class."],
          ["A valid place", "A class that needs off-budget cannot sit on an on-budget account (a Fixed Deposit among them), and a credit card cannot sit on an off-budget one. An account left out of reports must be off budget."],
          ["Nothing else", "Access is never required: every class has a default."],
          ["Closed accounts", "A closed account with no transactions and a zero balance needs nothing. One with history must be classified."],
        ]} />
        <Heading>Doing it quickly</Heading>
        <Grid>
          <Card icon={Layers} tone="value" title="Use groups">Set the class once on a group and every member inherits it, including accounts added later.</Card>
          <Card icon={Layers} tone="income" title="Select several">Select rows and set the class for all of them at once. Access is changed per account in the Accessible column.</Card>
          <Card icon={Layers} tone="warn" title="Follow the attention list">The table counts accounts that are unclassified, and can filter to just those or to the accounts left out of reports.</Card>
        </Grid>
        <Para>When you return to Financial Insights it checks again by itself. If a new unclassified account appears later, the page locks again and removes its figures until it is classified.</Para>
        <Heading>Common questions</Heading>
        <Example caption="Questions" head={["Question", "Answer"]} rows={[
          ["Can I change a class later?", "Yes. Figures that use it update the next time you open the page."],
          ["Why can’t I pick Investment for an on-budget account?", "Fixed Deposit, Investment, Retirement, Property, Vehicle, Other Fixed Asset and Loan are off-budget only (Credit Card is on-budget only). Choose a class that works on budget."],
          ["Why is the Accessible cell just text?", "On budget, money is always available. A card, a thing you own and a debt have no access to choose."],
          ["Is a savings account cash?", "Yes when you can use it now, in the default Cash + savings view of Financial Insights. Choose Cash to see Checking and Cash only."],
          ["Where are my choices kept?", "In Bench’s own database for this budget, not in your budget file."],
        ]} />
      </>}
    </GuideFrame>
  );
}
