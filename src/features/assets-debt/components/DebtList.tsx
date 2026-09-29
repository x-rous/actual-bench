"use client";

import { useRef } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Ban, CircleCheck, CircleDashed, Archive } from "lucide-react";
import type { DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { formatMinor } from "../lib/money";
import { DEBT_TYPE_OPTIONS, labelOf, STRATEGY_OPTIONS } from "../lib/vocabulary";

/**
 * The Loans & Debt list (RD-084 P1.3; FR-197, FR-204, FR-206).
 *
 * Virtualized, so a long list keeps a bounded DOM. Every status is spelled out
 * in text next to its icon, never colour alone. A debt Blocked because it was
 * configured by a newer Actual Bench says so on its own row; the rest of the
 * list stays usable.
 */

const ROW_HEIGHT = 52;

export type DebtStatusView = { label: string; icon: typeof Ban; tone: string };

export function statusOf(debt: DebtSummary): DebtStatusView {
  if (debt.blocked) {
    const label = debt.blocked.code === "invalid-config" ? "Blocked: the saved configuration cannot be used" : "Blocked: configured by a newer version of Actual Bench";
    return { label, icon: Ban, tone: "text-destructive" };
  }
  if (debt.status === "active") return { label: "Active", icon: CircleCheck, tone: "text-foreground" };
  if (debt.status === "archived") return { label: "Archived", icon: Archive, tone: "text-muted-foreground" };
  if (debt.status === "draft") return { label: "Draft", icon: CircleDashed, tone: "text-muted-foreground" };
  return { label: "Blocked: unknown status", icon: Ban, tone: "text-destructive" };
}

export function DebtList({ debts }: { debts: DebtSummary[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual; the compiler skips this component, which is what it needs.
  const virtualizer = useVirtualizer({
    count: debts.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    // Lets the first render (and a test DOM without layout) size the window.
    initialRect: { width: 800, height: 600 },
  });

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" role="region" aria-label="Debts">
      <ul role="list" aria-label={`${debts.length} debt${debts.length === 1 ? "" : "s"}`} style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const debt = debts[item.index];
          const status = statusOf(debt);
          const Icon = status.icon;
          const type = typeof debt.debtType === "string" ? labelOf(DEBT_TYPE_OPTIONS, debt.debtType) : "Unknown type";
          const strategy = typeof debt.executionStrategy === "string" ? labelOf(STRATEGY_OPTIONS, debt.executionStrategy) : "Unknown strategy";
          return (
            <li
              key={debt.id}
              aria-setsize={debts.length}
              aria-posinset={item.index + 1}
              style={{ position: "absolute", top: 0, left: 0, right: 0, height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              className="border-b border-border/50"
            >
              <Link href={`/assets-debt/loans/${encodeURIComponent(debt.id)}`} className="flex h-full items-center gap-3 px-4 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                <Icon className={`h-4 w-4 shrink-0 ${status.tone}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{debt.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {type} · {strategy} · revision {debt.currentRevision}
                  </span>
                </span>
                {debt.openingPrincipalMinor !== null && !debt.blocked ? (
                  <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">Opened at {formatMinor(debt.openingPrincipalMinor, debt.currencyMinorDigits, debt.currency)}</span>
                ) : null}
                <span className={`text-xs font-medium ${status.tone}`}>{status.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
