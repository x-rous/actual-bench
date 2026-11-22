"use client";

import React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { AccountClass } from "@/lib/account-class";
import { ACCESS_LABEL, accessChoosable, accessFlagChanges, accessOf, classHasAccess, type Access } from "@/lib/account-class/access";
import type { AccountFlag } from "@/lib/account-class/flags";

/** The saved flags of one account as the Accounts table holds them (whether each is saved, not whether it applies). */
export type AccountFlagState = { excluded: boolean; accessible: boolean; locked: boolean };

export type AccountFlagEdit = { flag: AccountFlag; on: boolean };

/** No flag saved: the class defaults apply and the account is included. */
export const NO_FLAGS: AccountFlagState = { excluded: false, accessible: false, locked: false };

/** What a class without access says in the Accessible column. */
function noAccessText(accountClass: AccountClass): string {
  switch (accountClass) {
    case "credit-card": return "Comes off cash";
    case "property":
    case "vehicle":
    case "fixed-asset": return "Sell to use";
    default: return "Debt";
  }
}

/**
 * Whether the account's money can be used now. An on-budget account always can (Actual lets you assign it); an off-budget account of a
 * class with access takes its class's default (Checking, Cash and Savings available; Fixed Deposit, Investment, Retirement and Other
 * Asset locked) until the user chooses. A saved choice that cannot apply (the account is on budget, or its class has no access) is kept.
 */
export const AccountAccessCell = React.memo(function AccountAccessCell({
  accountId,
  accountName,
  accountClass,
  offBudget,
  flags,
  disabled,
  onChange,
}: {
  accountId: string;
  accountName: string;
  accountClass: AccountClass | null;
  offBudget: boolean;
  flags: AccountFlagState;
  disabled: boolean;
  onChange: (accountId: string, edits: AccountFlagEdit[]) => void;
}) {
  const muted = "block truncate whitespace-nowrap px-2 text-xs text-muted-foreground";
  if (!accountClass) return <span className={`${muted} text-muted-foreground/70`}>Choose a class first</span>;
  if (!classHasAccess(accountClass)) return <span className={muted} title={accountClass === "credit-card" ? "What you owe on the card comes off cash" : undefined}>{noAccessText(accountClass)}</span>;
  const access = accessOf(accountClass, offBudget, flags)!;
  if (!accessChoosable(accountClass, offBudget)) {
    return <span className={muted} title="On budget: Actual lets you assign this money, so it counts as available now.">Available (on budget)</span>;
  }
  return (
    <Select
      size="sm"
      className="h-6"
      disabled={disabled}
      aria-label={`Accessible: ${accountName || "unnamed account"}`}
      title="Money you could use within days without selling something you own. It counts towards cash and the cash buffer."
      value={access}
      options={[{ value: "available", label: ACCESS_LABEL.available }, { value: "locked", label: ACCESS_LABEL.locked }]}
      onValueChange={(next) => {
        const wanted = accessFlagChanges(accountClass, next as Access);
        const edits: AccountFlagEdit[] = [];
        if (flags.accessible !== wanted.accessible) edits.push({ flag: "accessible", on: wanted.accessible });
        if (flags.locked !== wanted.locked) edits.push({ flag: "locked", on: wanted.locked });
        if (edits.length) onChange(accountId, edits);
      }}
    />
  );
});

/**
 * Whether the account counts in reports (Financial Insights and Cashflow's automatic roles). Only an off-budget account can be left
 * out: an on-budget one would hide spending. A group that is left out decides for its members, and so does a group whose class the
 * account takes. A saved "left out" on an account that is now on budget is shown so it can be cleared.
 */
export const AccountReportsCell = React.memo(function AccountReportsCell({
  accountId,
  accountName,
  offBudget,
  excluded,
  excludedByGroup = false,
  classFromGroup = false,
  groupName,
  disabled,
  onChange,
}: {
  accountId: string;
  accountName: string;
  offBudget: boolean;
  /** The account's own saved "left out" (already ignored when the group decides). */
  excluded: boolean;
  excludedByGroup?: boolean;
  classFromGroup?: boolean;
  groupName?: string;
  disabled: boolean;
  onChange: (accountId: string, edits: AccountFlagEdit[]) => void;
}) {
  const leftOut = excluded || excludedByGroup;
  const savedOnBudget = excluded && !offBudget;
  if (!offBudget && !savedOnBudget) return <span className="px-2 text-xs text-muted-foreground">Included</span>;
  const byGroup = excludedByGroup || classFromGroup;
  const name = accountName || "unnamed account";
  const label = savedOnBudget ? "Left out (not applied: on budget)" : leftOut ? "Left out of reports" : "Included";
  const hint = excludedByGroup ? `Left out by group${groupName ? ` “${groupName}”` : ""}. Change it on the group.`
    : classFromGroup ? `This account takes its class from group${groupName ? ` “${groupName}”` : ""}, so the group decides.`
    : savedOnBudget ? "On-budget accounts are always included. Click to clear the saved choice."
    : leftOut ? "Click to include this account in Financial Insights and Cashflow again." : "Click to leave this account out of Financial Insights and Cashflow.";
  const Icon = leftOut ? EyeOff : Eye;
  return (
    <span className="flex items-center gap-1 px-2 text-xs">
      <span className={leftOut ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>{label}</span>
      <button
        type="button"
        aria-label={`${leftOut ? "Include" : "Leave out"} ${name} ${leftOut ? "in" : "of"} reports`}
        aria-pressed={leftOut}
        title={hint}
        disabled={disabled || byGroup}
        onClick={() => onChange(accountId, [{ flag: "excluded", on: !excluded }])}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <Icon className="size-3.5" aria-hidden />
      </button>
    </span>
  );
});
