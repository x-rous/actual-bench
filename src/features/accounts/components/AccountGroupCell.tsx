"use client";

import React, { useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import type { AccountGroup } from "@/types/entities";
import { NEW_GROUP, NO_GROUP, groupLabel } from "../lib/accountGroups";

/** Options for any "pick a group" dropdown: no group, each group, then "New group…". */
export function buildGroupOptions(groups: AccountGroup[]) {
  return [
    { value: NO_GROUP, label: "No group" },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
    { value: NEW_GROUP, label: "New group…" },
  ];
}

export const AccountGroupCell = React.memo(
  function AccountGroupCell({
    accountId,
    accountName,
    groupId,
    groups,
    disabled,
    onAssign,
    onRequestNewGroup,
  }: {
    accountId: string;
    accountName: string;
    groupId: string | null | undefined;
    groups: AccountGroup[];
    disabled: boolean;
    onAssign: (accountId: string, groupId: string | null) => void;
    onRequestNewGroup: (accountId: string) => void;
  }) {
    const [isEditing, setIsEditing] = useState(false);
    const label = groupLabel(groupId, groups);
    const options = useMemo(() => buildGroupOptions(groups), [groups]);
    const current = groupId && groups.some((g) => g.id === groupId) ? groupId : NO_GROUP;

    if (disabled) {
      return <span className="text-xs text-muted-foreground">{label}</span>;
    }

    if (!isEditing) {
      return (
        <button
          type="button"
          className="flex h-6 w-full items-center rounded border border-transparent bg-background px-1.5 text-left text-xs hover:border-border hover:bg-muted/20"
          onClick={() => setIsEditing(true)}
          title={`Change group of ${accountName || "this account"}`}
          aria-label={`Group of ${accountName || "unnamed account"}: ${label}. Change group`}
        >
          <span className={current === NO_GROUP ? "truncate text-muted-foreground" : "truncate"}>{label}</span>
        </button>
      );
    }

    return (
      <Select
        defaultOpen
        size="sm"
        className="h-6"
        aria-label={`Group of ${accountName || "unnamed account"}`}
        value={current}
        onOpenChange={(open) => {
          if (!open) setIsEditing(false);
        }}
        onValueChange={(next) => {
          setIsEditing(false);
          if (next === NEW_GROUP) onRequestNewGroup(accountId);
          else if (next === NO_GROUP) onAssign(accountId, null);
          else onAssign(accountId, next);
        }}
        options={options}
      />
    );
  }
);
