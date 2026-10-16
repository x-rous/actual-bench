"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = {
  onSetup: () => void;
  onStatements?: () => void;
  onClassifications?: () => void;
  onPlans?: () => void;
};

/** Contextual guidance uses the same actions as the workspace; it never writes Actual data. */
export function HowToUse({ onSetup, onStatements, onClassifications, onPlans }: Props) {
  const [open, setOpen] = useState(false);
  const action = (label: string, callback?: () => void) => callback && <Button size="sm" variant="outline" onClick={() => { setOpen(false); callback(); }}>{label}</Button>;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button size="sm" variant="outline" />}><CircleHelp className="size-3.5" />How to use</DialogTrigger>
    <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl">
      <DialogTitle>Credit cards, simply</DialogTitle>
      <DialogDescription>Read Actual transactions, check your statements, and see what to pay and what you owe.</DialogDescription>
      <Tabs defaultValue="start" className="min-h-0 flex-1">
        <TabsList aria-label="Credit card help topics" className="mb-4 flex-wrap">
          <TabsTrigger value="start">Get started</TabsTrigger><TabsTrigger value="classifications">Classifications</TabsTrigger><TabsTrigger value="statements">Statements & payments</TabsTrigger><TabsTrigger value="plans">Plans</TabsTrigger><TabsTrigger value="links">Linking & tags</TabsTrigger>
        </TabsList>
        <TabsContent value="start" className="max-h-[55dvh] space-y-4 overflow-auto text-sm">
          <p>Add an account classified as Credit Card, then enter its billing dates and minimum percentage and floor. Start with an opening statement or today’s available history.</p>
          <p>Refresh reads Actual again. Bench’s card setup, corrections and links stay in this browser tab only. Closing or reloading the tab loses them during this preview phase.</p>
          {action("Open card setup", onSetup)}
        </TabsContent>
        <TabsContent value="classifications" className="max-h-[55dvh] space-y-4 overflow-auto text-sm">
          <p>Every transaction gets a type from your categories, account relationships, descriptions, or a purchase/credit default. Select its classification to see the reason and correct it.</p>
          <p>Classification describes the money. Statement inclusion chooses the bill. A plan link chooses the agreement. Linking interest to a plan keeps it as interest.</p>
          <p>Corrections apply across Bench without changing Actual categories or notes. Non-transfer payment credits and returned-payment cancellation are reserved for a later update.</p>
          {action("Review classifications", onClassifications)}
        </TabsContent>
        <TabsContent value="statements" className="max-h-[55dvh] space-y-4 overflow-auto text-sm">
          <p><strong>Statement balance</strong> is the bank’s closing figure. <strong>Total Payment Due</strong> is this month’s original target; it defaults to that balance until you enter a different amount. <strong>Remaining to pay</strong> subtracts confirmed payments and applicable credits.</p>
          <p>The minimum counts confirmed payments only. Pending amounts are shown separately. Paid this month can leave plan debt outstanding; Paid in full refers to the statement, not every future charge.</p>
          <p>Include only transactions printed on that bill. Later or near-cutoff purchases can await the next bill. A genuine Balance difference needs corrected statement values or Actual transactions.</p>
          {action("Open statements", onStatements)}
        </TabsContent>
        <TabsContent value="plans" className="max-h-[55dvh] space-y-4 overflow-auto text-sm">
          <p>Start a plan from one or several transactions, a balance/reference, or a dated remaining balance for an existing agreement. Choose Track balance only when a schedule is unnecessary.</p>
          <p>With the off-budget flow, conversion moves principal into the plan account; billing moves it back onto the card. Total debt counts both once. Only a real payment or debt credit reduces the combined amount. Interest and fees stay separate expenses.</p>
          <p>30,000 over six months: billing 5,000 leaves 30,000 total debt; paying that 5,000 leaves 25,000. Billed progress does not mean Paid. Early release or closing plan metadata does not erase what is still owed.</p>
          {action("Review repayment plans", onPlans)}
        </TabsContent>
        <TabsContent value="links" className="max-h-[55dvh] space-y-4 overflow-auto text-sm">
          <p>Tags are optional. Use the plan’s Transactions tab or a statement-review row to link entries. Suggestions use references, reciprocal account transfers, amounts and dates; select the right plan when several match.</p>
          <p>Use Suggested, Linked or All entries, inspect the amounts, and Apply selected links before Save plan. Several principal and cost components can belong to one instalment. A combined bill stays Combined instalment unless the actual split is known.</p>
          <p>One shared plan account can serve several cards. Assign entries or a dated opening to each plan; Review plan entries shows amounts still unassigned. Different posting dates or clearing states do not invalidate a reciprocal transfer.</p>
          {action("Open plan linking", onPlans)}
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
