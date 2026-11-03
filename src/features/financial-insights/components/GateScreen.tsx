"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Gate, SetupRow } from "../hooks/useFinancialInsights";
import { LoadingState } from "./LoadingState";

const REASON: Record<SetupRow["status"], string> = {
  "needs-class": "Needs an account class",
  "needs-choice": "Needs a Financial Reporting choice",
  "incompatible-placement": "Its class does not fit its budget placement",
};

/**
 * What shows instead of every figure until each account is understood. No numbers, no partial view: setup happens
 * only in Accounts, so there is a single place to classify.
 */
export function GateScreen({ gate, onCheckAgain }: { gate: Exclude<Gate, { state: "ready" }>; onCheckAgain: () => void }) {
  if (gate.state === "none") {
    return <Notice title="Connect to a budget" body="Financial Insights reads the budget you have open." />;
  }
  if (gate.state === "loading") {
    return <LoadingState title="Checking your accounts…" />;
  }
  if (gate.state === "error") {
    return <Notice title="We could not check your accounts" body="No figures are shown until every account has been checked." action={<Button size="sm" onClick={gate.retry}>Retry</Button>} />;
  }
  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <h2 className="text-lg font-semibold">Let’s make sure every account is understood.</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Financial Insights needs an account class for every account, and a current or non-current choice for Investment, Other Asset and Other Liability accounts, before it shows any figure.
        {" "}{gate.rows.length} {gate.rows.length === 1 ? "account needs" : "accounts need"} attention.
      </p>
      <ul className="mt-4 divide-y divide-border rounded-lg border border-border" aria-label="Accounts that need attention">
        {gate.rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="truncate font-medium">{row.name}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="size-3.5" aria-hidden />{REASON[row.status]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2">
        <Link href="/accounts" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">Open Accounts</Link>
        <Button size="sm" variant="outline" onClick={onCheckAgain}>Check again</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Set the class and the choice in the Accounts table, then come back. This page also checks again each time it opens.</p>
    </div>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md space-y-3 p-8 text-center">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}
