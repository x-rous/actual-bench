"use client";

import { useRouter } from "next/navigation";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { useEntityUsage } from "../hooks/useEntityUsage";
import type { EntityUsageData } from "../types";

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  entityId: string | null;
  entityType: EntityUsageData["entityType"] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ENTITY_DISPLAY_NAME: Record<EntityUsageData["entityType"], string> = {
  account:       "Account",
  payee:         "Payee",
  category:      "Category",
  categoryGroup: "Category Group",
  schedule:      "Schedule",
  tag:           "Tag",
};

function rulesUrl(entityType: EntityUsageData["entityType"], entityId: string): string | null {
  switch (entityType) {
    case "account":  return `/rules?accountId=${entityId}`;
    case "payee":    return `/rules?payeeId=${entityId}`;
    case "category": return `/rules?categoryId=${entityId}`;
    default:         return null;
  }
}

// ─── UsageInspectorDrawer ─────────────────────────────────────────────────────

export function UsageInspectorDrawer({ entityId, entityType, open, onOpenChange }: Props) {
  const router = useRouter();
  const usage = useEntityUsage(entityId, entityType, open);

  const isEmpty =
    usage &&
    !usage.txLoading &&
    usage.ruleCount === 0 &&
    (usage.txCount === undefined || usage.txCount === 0) &&
    (usage.balance === undefined || Math.abs(usage.balance) === 0) &&
    usage.warnings.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[380px] flex-col gap-0 p-0 sm:w-[420px]">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-sm font-semibold">
            {usage?.entityLabel || "Usage Inspector"}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {usage ? ENTITY_DISPLAY_NAME[usage.entityType] : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {!usage ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : (
            <>
              {/* ── Stats row ────────────────────────────────────────────── */}
              <div className="flex flex-wrap gap-2">
                {/* Rules badge — always shown */}
                <StatBadge label="Rules" value={String(usage.ruleCount)} />

                {/* Tx count badge — not for tags */}
                {usage.entityType !== "tag" && (
                  <StatBadge
                    label="Transactions"
                    value={usage.txLoading ? "…" : String(usage.txCount ?? 0)}
                    loading={usage.txLoading}
                  />
                )}

                {/* Balance badge — accounts only */}
                {usage.entityType === "account" && usage.balance !== undefined && (
                  <StatBadge
                    label="Balance"
                    value={usage.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    variant={Math.abs(usage.balance) > 0 ? "warn" : "neutral"}
                  />
                )}

                {/* Child count — category groups only */}
                {usage.entityType === "categoryGroup" && usage.childCount !== undefined && (
                  <StatBadge label="Categories" value={String(usage.childCount)} />
                )}
              </div>

              {/* ── Tags note ────────────────────────────────────────────── */}
              {usage.entityType === "tag" && (
                <p className="text-xs text-muted-foreground italic">
                  Transaction data is not available for tags.
                </p>
              )}

              {/* ── Loading state ─────────────────────────────────────────── */}
              {usage.txLoading && (
                <p className="text-xs text-muted-foreground">Checking usage...</p>
              )}

              {/* ── Warnings ─────────────────────────────────────────────── */}
              {usage.warnings.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Impact
                  </h3>
                  <ul className="space-y-1.5">
                    {usage.warnings.map((w) => (
                      <li key={String(w)} className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-relaxed">
                        {w}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* ── Empty state ───────────────────────────────────────────── */}
              {isEmpty && (
                <p className="text-xs text-muted-foreground italic">
                  No known references found.
                </p>
              )}

              {/* ── Quick links ───────────────────────────────────────────── */}
              {usage.ruleCount > 0 && entityId && entityType && (
                (() => {
                  const url = rulesUrl(entityType, entityId);
                  return url ? (
                    <section>
                      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Quick Links
                      </h3>
                      <button
                        className="text-xs text-primary underline hover:opacity-80"
                        onClick={() => { router.push(url); onOpenChange(false); }}
                      >
                        View rules →
                      </button>
                    </section>
                  ) : null;
                })()
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── StatBadge ────────────────────────────────────────────────────────────────

function StatBadge({
  label, value, loading = false, variant = "neutral",
}: {
  label: string;
  value: string;
  loading?: boolean;
  variant?: "neutral" | "warn";
}) {
  return (
    <div className="flex flex-col items-center rounded-md border border-border/60 bg-muted/20 px-3 py-2 min-w-[72px]">
      <span className={`text-sm font-semibold tabular-nums ${loading ? "text-muted-foreground" : variant === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
