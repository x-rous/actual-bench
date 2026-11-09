// Preserved for comparison and possible restoration at the user's request.
import { UserRound, FilePenLine, type LucideIcon } from "lucide-react";
import { ACCOUNT_CLASS_ICONS } from "@/features/accounts/lib/accountClassIcons";
import type { AccountClass } from "@/lib/account-class";

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
  { name: "Investments", icon: ACCOUNT_CLASS_ICONS.investment, placement: "Off budget · Investment, with an optional Accessible money setting", examples: [
    { label: "Put in", left: account("Checking · on budget", "bank"), right: account("Brokerage · off budget", "investment"), direction: "right", recorded: "Transfer; the on-budget side carries the category.", result: "Funding / Put into investments; not Spent." },
    { label: "Withdraw", left: account("Checking · on budget", "bank"), right: account("Brokerage · off budget", "investment"), direction: "left", recorded: "Withdrawal recorded as a transfer.", result: "Withdrawals / Withdrawn from investments; not Received." },
    { label: "Between investments", left: account("Brokerage A · off budget", "investment"), right: account("Brokerage B · off budget", "investment"), direction: "right", recorded: "Transfer between two portfolio accounts; neither side has a category.", result: "Other per account; cancels in the portfolio total when both sides are in the period." },
    { label: "Investment activity", left: other("Recorded value change"), right: account("Brokerage · off budget", "investment"), direction: "entry", recorded: "Uncategorized non-transfer entry, such as a dividend or price change.", result: "Investment activity, not a calculated return." },
  ] },
  { name: "Loans", icon: ACCOUNT_CLASS_ICONS.loan, placement: "Off budget · Loan liability", examples: [
    { label: "Borrow", left: account("Checking · on budget", "bank"), right: account("Loan · off budget", "loan"), direction: "left", recorded: "Borrowed money recorded as a transfer.", result: "Borrowed (received from loans); not Received income." },
    { label: "Repay principal", left: account("Checking · on budget", "bank"), right: account("Loan · off budget", "loan"), direction: "right", recorded: "Principal repaid as a transfer; the on-budget side carries a category.", result: "Loan principal repaid; not Spent." },
    { label: "Interest & fees", left: account("Checking · on budget", "bank"), right: other("Lender · outside payee"), direction: "right", impact: "spent", recorded: "Separate interest or fee entry with an expense category.", result: "Spent. Interest paid / Fees paid identified for tracked loans only." },
    { label: "Loan adjustment", left: other("Recorded charge"), right: account("Loan · off budget", "loan"), direction: "entry", recorded: "Uncategorized non-transfer entry, for example capitalized interest.", result: "Unidentified movements; not Interest paid or Spent." },
  ] },
  { name: "Credit cards", icon: ACCOUNT_CLASS_ICONS["credit-card"], placement: "On budget only · Credit card liability", examples: [
    { label: "Card purchase", left: account("Card · on budget", "credit-card"), right: other("Grocery store · outside payee"), direction: "right", impact: "spent", recorded: "Purchase with a grocery category.", result: "Spent rises when recorded; card debt rises." },
    { label: "Pay card", left: account("Checking · on budget", "bank"), right: account("Card · on budget", "credit-card"), direction: "right", recorded: "Transfer to pay the card. Both accounts are on budget.", result: "Cash falls; not Spent again." },
    { label: "Card kept off budget", left: other("Outside payee"), right: account("Card · off budget", "credit-card"), direction: "left", recorded: "A credit card must be on budget so its purchases count as spending. An off-budget card is not ready.", result: "Financial Insights shows nothing until another class is chosen for the card, or the card is left out of Financial Insights." },
  ] },
  { name: "Property & assets", icon: ACCOUNT_CLASS_ICONS.property, placement: "Property and Vehicle classes are off budget · Fixed assets", examples: [
    { label: "Buy property", left: account("Checking · on budget", "bank"), right: account("Property · off budget", "property"), direction: "right", recorded: "Purchase recorded as a transfer; the on-budget side carries a category.", result: "Asset value rises; not Spent. Assets may classify Capital added." },
    { label: "Value change", left: other("Recorded value change"), right: account("Property · off budget", "property"), direction: "entry", recorded: "Entry classified in Assets as revaluation or depreciation.", result: "Revaluation / Depreciation when classified in Assets." },
    { label: "Link a loan", left: account("Loan · off budget", "loan"), right: account("Property · off budget", "property"), direction: "link", recorded: "The loan is linked to the asset in Assets. This link is not a transaction.", result: "Debt against assets and Equity in Property & assets." },
  ] },
  { name: "Other accounts", icon: ACCOUNT_CLASS_ICONS["other-liability"], placement: "Other Liability may be on or off budget; an off-budget account can be left out of Financial Insights", examples: [
    { label: "Other liability", left: account("Checking · on budget", "bank"), right: account("Liability · off budget", "other-liability"), direction: "right", recorded: "A transfer to an Other Liability account.", result: "Other liabilities change; the transfer is not Spent." },
    { label: "Account left out", left: account("Checking · on budget", "bank"), right: account("Savings · off budget", "bank"), direction: "right", recorded: "A transfer to an off-budget account set to “Include in Financial Insights: off”.", result: "Transfers with excluded accounts; excluded balance is outside net worth." },
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

/** Account movements and their reporting outcomes, visible together. */
export function PreviousFlowOverview() {
  return <div className="max-w-[64.5rem]">
    <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/80" aria-label="Arrow color legend">
      <span><b aria-hidden="true" style={{ color: "var(--fi-income)" }}>→</b> Received</span>
      <span><b aria-hidden="true" style={{ color: "var(--fi-spend)" }}>→</b> Spent</span>
      <span><b aria-hidden="true" className="text-muted-foreground">→</b> Neither received nor spent</span>
    </p>
    <div className="columns-1 gap-3 md:columns-2">
      {FLOW_GROUPS.map((group, index) => {
        const Icon = group.icon;
        const colour = FLOW_GROUP_COLOURS[index];
        return <section key={group.name} aria-label={group.name} className="mb-3 inline-block w-full break-inside-avoid overflow-hidden rounded-lg border bg-card align-top">
          <div className="border-b px-3 py-2" style={{ backgroundColor: `color-mix(in srgb, ${colour} 10%, var(--card))` }}><p className="flex items-center gap-1.5 text-[13px] font-semibold"><Icon className="size-4" style={{ color: colour }} aria-hidden="true" />{group.name}</p><p className="mt-0.5 text-xs leading-snug text-muted-foreground">{group.placement}</p></div>
          <dl className="divide-y divide-border/60 px-3">{group.examples.map(({ label, left, right, direction, impact, recorded, result }) => <div key={label} className="py-2 text-xs leading-relaxed">
            <dt className="grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-start font-medium text-foreground"><FlowAccountNode node={left} /><span className="text-center font-semibold text-muted-foreground" style={{ color: impact === "received" ? "var(--fi-income)" : impact === "spent" ? "var(--fi-spend)" : undefined }} aria-label={`${direction === "right" ? "to" : direction === "left" ? "from" : direction === "link" ? "linked to" : "recorded in"}; ${impact === "received" ? "received" : impact === "spent" ? "spent" : "neither received nor spent"}`}>{direction === "right" ? "→" : direction === "left" ? "←" : direction === "link" ? "+" : "→"}</span><FlowAccountNode node={right} align="right" /></dt>
            <dd className="mt-0.5 text-foreground/80">{!result.toLowerCase().startsWith(label.toLowerCase()) && <span className="font-medium text-foreground">{label}: </span>}{result}<span className="sr-only"> {recorded}</span></dd>
          </div>)}</dl>
        </section>;
      })}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Transfers are not income or spending. Across the budget boundary, Actual puts the category on the on-budget side. Off-budget entries have no category. Transfers between included accounts cancel when both sides are in the period.</p>
  </div>;
}
