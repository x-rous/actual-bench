"use client";

import React, { useMemo } from "react";
import { Select } from "@/components/ui/select";
import { ACCOUNT_CLASS_INFO, accountClassLabel, type AccountClass, type EffectiveAccountClass } from "@/lib/account-class";
import { ACCOUNT_CLASS_ICONS, UNCLASSIFIED_ICON } from "../lib/accountClassIcons";

export const UNCLASSIFIED = "__unclassified__";

/** An account class as its icon and name. The icon is decoration: the name carries the meaning. */
export function AccountClassLabel({ accountClass }: { accountClass: AccountClass | null }) {
  const Icon = accountClass ? ACCOUNT_CLASS_ICONS[accountClass] : UNCLASSIFIED_ICON;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{accountClass ? accountClassLabel(accountClass) : "Unclassified"}</span>
    </span>
  );
}

/** Options for any "pick an account class" dropdown: unclassified, then assets, then liabilities. */
export function buildAccountClassGroups() {
  const toOption = (info: (typeof ACCOUNT_CLASS_INFO)[number]) => ({ value: info.value, label: <AccountClassLabel accountClass={info.value} /> });
  return [
    { label: "Assets", options: ACCOUNT_CLASS_INFO.filter((i) => i.side === "asset").map(toOption) },
    { label: "Liabilities", options: ACCOUNT_CLASS_INFO.filter((i) => i.side === "liability").map(toOption) },
  ];
}

export const UNCLASSIFIED_OPTIONS = [{ value: UNCLASSIFIED, label: <AccountClassLabel accountClass={null} /> }];

/**
 * The account class of one account. A class inherited from the account's group is
 * shown read-only; change it on the group.
 */
export const AccountClassCell = React.memo(function AccountClassCell({
  accountId,
  accountName,
  effective,
  groupName,
  disabled,
  onChange,
}: {
  accountId: string;
  accountName: string;
  effective: EffectiveAccountClass;
  groupName?: string;
  disabled: boolean;
  onChange: (accountId: string, accountClass: AccountClass | null) => void;
}) {
  const groups = useMemo(() => buildAccountClassGroups(), []);

  if (effective.source === "group" && effective.accountClass) {
    return (
      <span
        className="flex items-center gap-1.5 text-xs"
        title={groupName ? `Inherited from the group "${groupName}". Change it on the group.` : "Inherited from the account group"}
      >
        <AccountClassLabel accountClass={effective.accountClass} />
        <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">Inherited</span>
      </span>
    );
  }

  return (
    <Select
      size="sm"
      className="h-6"
      disabled={disabled}
      aria-label={`Account class of ${accountName || "unnamed account"}`}
      value={effective.accountClass ?? UNCLASSIFIED}
      options={UNCLASSIFIED_OPTIONS}
      groups={groups}
      onValueChange={(next) => onChange(accountId, next === UNCLASSIFIED ? null : (next as AccountClass))}
    />
  );
});
