"use client";

import { ChevronDown, ChevronRight, FolderTree } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccountClass } from "@/lib/account-class";
import { formatCents, type AccountCluster, type GroupBy } from "../lib/accountClusters";
import { AccountClassLabel } from "./AccountClassCell";

function Subtotal({ cents }: { cents: number | null }) {
  if (cents === null) return <span className="text-xs text-muted-foreground/50">-</span>;
  return <span className={cn("text-xs font-medium", cents < 0 && "text-destructive")}>{formatCents(cents)}</span>;
}

/**
 * The heading row of one cluster: a toggle, what the cluster is, how many
 * accounts it holds and their balance subtotal, under the Balance column.
 */
export function AccountClusterHeader({
  cluster,
  by,
  collapsed,
  onToggle,
  groupClass,
  leadingColSpan,
  trailingColSpan,
}: {
  cluster: AccountCluster<unknown>;
  by: Exclude<GroupBy, "none">;
  collapsed: boolean;
  onToggle: (key: string) => void;
  /** The class set on the group, shown beside a group's name. */
  groupClass?: AccountClass;
  /** Columns before and after the Balance column. */
  leadingColSpan: number;
  trailingColSpan: number;
}) {
  const count = cluster.rows.length;
  return (
    <tr className="border-b border-border/40 bg-muted/30">
      <td colSpan={leadingColSpan} className="px-2 py-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${cluster.label}, ${count} account${count === 1 ? "" : "s"}`}
          onClick={() => onToggle(cluster.key)}
          className="flex items-center gap-1.5 text-xs font-medium"
        >
          {collapsed ? <ChevronRight className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
          {by === "class" ? (
            <AccountClassLabel accountClass={cluster.accountClass} />
          ) : (
            <>
              <FolderTree className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{cluster.label}</span>
              {groupClass && <AccountClassLabel accountClass={groupClass} />}
            </>
          )}
          <span className="font-normal text-muted-foreground">({count})</span>
        </button>
      </td>
      <td className="px-4 py-1 text-right tabular-nums">
        <Subtotal cents={cluster.subtotalCents} />
      </td>
      <td colSpan={trailingColSpan} />
    </tr>
  );
}

/** The closing row of a grouped table: the balance of every account shown, in every cluster. */
export function AccountTotalRow({ cents, leadingColSpan, trailingColSpan }: { cents: number | null; leadingColSpan: number; trailingColSpan: number }) {
  return (
    <tr className="border-t border-border bg-muted/20">
      <td colSpan={leadingColSpan} className="px-2 py-1 text-xs font-medium">
        Total
      </td>
      <td className="px-4 py-1 text-right tabular-nums">
        <Subtotal cents={cents} />
      </td>
      <td colSpan={trailingColSpan} />
    </tr>
  );
}
