"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = { onSetup: () => void; onStatements?: () => void; onClassifications?: () => void; onPlans?: () => void };
function HelpCard({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-lg border p-3"><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3><div className="text-xs leading-relaxed text-muted-foreground">{children}</div></div>;
}
function Steps({ items }: { items: [string, string][] }) {
  return <ol className="grid gap-2 sm:grid-cols-2">{items.map(([title, text], index) => <li key={title} className="rounded-lg border p-3"><span className="mb-2 inline-flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span><h3 className="text-xs font-semibold">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p></li>)}</ol>;
}

/** Short visual examples and real workspace actions; no Actual writes. */
export function HowToUse({ onSetup, onStatements, onClassifications, onPlans }: Props) {
  const [open, setOpen] = useState(false);
  const action = (label: string, callback?: () => void) => callback && <Button size="sm" variant="outline" onClick={() => { setOpen(false); callback(); }}>{label}<ArrowRight className="size-3" aria-hidden /></Button>;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button size="sm" variant="outline" />}><CircleHelp className="size-3.5" aria-hidden />How to use</DialogTrigger>
    <DialogContent className="flex h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
      <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
      <DialogTitle className="text-sm">Credit cards, simply</DialogTitle>
      <DialogDescription>Know what to pay this month, what you still owe, and where each transaction belongs.</DialogDescription>
      </DialogHeader>
      <Tabs defaultValue="start" orientation="vertical" className="min-h-0 flex-1 flex-row overflow-hidden">
        <TabsList aria-label="Credit card help topics" className="w-44 flex-col items-stretch gap-0.5 self-stretch border-r border-b-0 border-border p-2 pt-3 [&>button]:px-2 [&>button]:py-1.5 [&>button]:text-left [&>button]:whitespace-normal [&>button]:after:hidden [&>button[data-active]]:bg-accent [&>button[data-active]]:text-accent-foreground">
          <TabsTrigger value="start">Get started</TabsTrigger><TabsTrigger value="classifications">Classifications</TabsTrigger><TabsTrigger value="statements">Statements & payments</TabsTrigger><TabsTrigger value="plans">Plans</TabsTrigger><TabsTrigger value="links">Linking & tags</TabsTrigger>
        </TabsList>
        <TabsContent value="start" className="min-w-0 space-y-4 overflow-y-auto px-5 py-4">
          <Steps items={[["Connect Actual", "Choose your budget. Bench reads its accounts and transactions."], ["Add your card", "Classify the account as Credit Card, then enter billing dates, minimums and your credit limit."], ["Confirm the opening", "Choose where tracking begins. Confirm the earliest statement using your bank figures."], ["Review Activity", "Check suggested classifications and link plans where needed. Refresh to read new transactions."]]} />
          <div className="grid gap-3 sm:grid-cols-3"><HelpCard title="Statement balance">What the bank billed at the end of the statement period.</HelpCard><HelpCard title="To pay">What is left of this month’s payment target, after confirmed payments. Refunds and credits reduce Total owed, not this target.</HelpCard><HelpCard title="Total owed">Everything you owe on the card and its assigned off-budget plan account, including spending since the statement.</HelpCard></div>
          <p className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">During this preview, card settings, statement decisions and plan links stay in this browser tab. Reloading or closing it loses them. Refresh reads Actual again and keeps these decisions.</p>
          {action("Open card setup", onSetup)}
        </TabsContent>
        <TabsContent value="classifications" className="min-w-0 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-3"><HelpCard title="1 · Read the transaction">Bench uses your categories, transfer accounts and descriptions to suggest a type. Ordinary debits default to Purchase; credits get a credit type.</HelpCard><HelpCard title="2 · Check the suggestion">Select the classification in Activity or statement review to see why it was chosen.</HelpCard><HelpCard title="3 · Correct when needed">Choose another type. Your correction updates Bench’s reports without changing the Actual category or notes.</HelpCard></div>
          <div className="overflow-hidden rounded-lg border text-xs"><div className="grid grid-cols-3 gap-3 bg-muted/30 p-3 font-medium"><span>Actual entry</span><span>Bench type</span><span>Used for</span></div>{[["Cafe · −42.00", "Purchase", "New charges"], ["Transfer from checking · +5,000.00", "Payment", "Repayment progress"], ["Plan processing · −30.00", "Fee", "Interest & fees"]].map((row) => <div key={row[0]} className="grid grid-cols-3 gap-3 border-t p-3">{row.map((text) => <span key={text}>{text}</span>)}</div>)}</div>
          <p className="text-xs text-muted-foreground">A plan link does not turn interest or fees into principal. Automatic returned-payment cancellation and additional non-transfer payment support are reserved for later.</p>
          {action("Review classifications", onClassifications)}
        </TabsContent>
        <TabsContent value="statements" className="min-w-0 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-3"><HelpCard title="Statement balance"><strong className="block text-xl text-foreground">30,000.00</strong>The bank’s closing balance. It can include debt that is not all due this month.</HelpCard><HelpCard title="Total Payment Due"><strong className="block text-xl text-foreground">5,000.00</strong>This month’s original target. Enter it if different; otherwise it defaults to the statement balance.</HelpCard><HelpCard title="To pay"><strong className="block text-xl text-foreground">4,000.00</strong>After a confirmed 1,000.00 payment. Refunds and credits do not change this payment target.</HelpCard></div>
          <Steps items={[["Confirm bank figures", "Enter the dates, closing balance and minimum from the bill."], ["Match its entries", "Include transactions printed on that statement. Leave later entries for the next one."], ["Save & verify", "A match confirms the statement figures. It does not mean the bill has been paid."], ["Track the deadline", "The timing rail shows payments toward this bill. Pending payments stay separate."]]} />
          <HelpCard title="Two different payment views">Payments in period are printed within that statement period, usually for the previous bill. Payment against due date shows repayment of the selected bill. The compact timeline shows four recent months and two ahead; future dates are estimates.</HelpCard>
          <p className="text-xs text-muted-foreground">The minimum counts confirmed payments only. Paid this month can leave debt outstanding; Paid in full refers to the statement balance.</p>
          {action("Open statements", onStatements)}
        </TabsContent>
        <TabsContent value="plans" className="min-w-0 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-xs text-muted-foreground">Example: a 30,000.00 plan over six months, with no interest or fees. Using an off-budget plan account:</p>
          <div className="grid gap-3 sm:grid-cols-3">{[["1 · Convert the purchase", "0.00", "30,000.00", "30,000.00"], ["2 · Bill one instalment", "5,000.00", "25,000.00", "30,000.00"], ["3 · Pay that instalment", "0.00", "25,000.00", "25,000.00"]].map(([title, card, plan, total]) => <HelpCard key={title} title={title}><dl className="space-y-1"><div className="flex justify-between"><dt>On card</dt><dd>{card}</dd></div><div className="flex justify-between"><dt>In plan account</dt><dd>{plan}</dd></div><div className="flex justify-between border-t pt-2 font-semibold text-foreground"><dt>Total owed</dt><dd>{total}</dd></div></dl></HelpCard>)}</div>
          <p className="rounded-lg bg-muted/30 p-3 text-xs">Billing moves debt. Paying reduces it. A billed instalment is not a paid instalment.</p>
          <div className="grid gap-3 sm:grid-cols-2"><HelpCard title="Already partway through?">Choose Track an existing plan and enter a dated remaining principal. You can leave the original amount unknown and track balance only.</HelpCard><HelpCard title="Paid early or missed a payment?">Link the actual principal movements and payments. Expected schedules do not create repayments. Fees and interest remain separate expenses.</HelpCard></div>
          {action("Review repayment plans", onPlans)}
        </TabsContent>
        <TabsContent value="links" className="min-w-0 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-3"><HelpCard title="What kind of money?">Classification → Purchase, Payment, Fee or another type.</HelpCard><HelpCard title="Which bank bill?">Statement decision → Include it in one statement or leave it out.</HelpCard><HelpCard title="Which agreement?">Plan link → Original purchase, conversion, billed principal, fee or refund.</HelpCard></div>
          <Steps items={[["Open Transactions", "Use a plan’s Transactions tab or the plan action beside a statement transaction."], ["Inspect the match", "Check the date, amount and suggested role. Suggestions never prove that something was paid."], ["Link the entry", "Choose its plan role and instalment number where relevant. Several components can share one instalment."], ["Save the plan", "Save applies these links. Classification and statement decisions remain separate."]]} />
          <HelpCard title="Tags are optional">Use Suggested matches, Linked or All entries to find this card’s transactions. A shared off-budget account can serve several cards; only the principal assigned to this card is added to its debt. Review plan entries shows this card’s unlinked transfers only.</HelpCard>
          {action("Open plan linking", onPlans)}
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
