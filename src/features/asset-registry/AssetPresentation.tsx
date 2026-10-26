"use client";
import type { ReactNode } from "react";
import { Box, Car, ChartNoAxesCombined, Coins, Gem, House, Landmark, Package } from "lucide-react";
import { StatusBadge } from "@/features/credit-cards/components/primitives/StatusBadge";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { assetHashtags } from "@/lib/asset-registry/ledger";
import { Figure } from "@/features/credit-cards/components/primitives/Figure";
import { BOOK_TYPES } from "@/lib/asset-registry/models";
import { cn } from "@/lib/utils";

/** "-" means not applicable or unknown, never zero (DESIGN §4.1). */
export const NA = "-";
export const assetMoney = (minor: number | null | undefined) => minor == null ? "Unavailable" : formatAmount(minor, 2);
export const bookTypeLabel = (classification: string | null): string => (BOOK_TYPES as Partial<Record<string, string>>)[classification ?? ""] ?? "Unclassified";

/** Presentation only: the complete, original Actual Notes remain in transaction details. */
export function bookNotes(notes: string | null) {
  return assetHashtags(notes ?? "").reduce((text, tag) => text.replaceAll(tag, ""), notes ?? "").replace(/\s+/g, " ").trim() || "-";
}
export function AssetMark({ type, header = false }: { type: string; header?: boolean }) {
  const icons: Record<string, typeof Box> = { "real-estate": House, vehicle: Car, investment: ChartNoAxesCombined, retirement: Landmark, crypto: Coins, "precious-metal": Gem, collectible: Package, other: Box };
  const Icon = icons[type] ?? Box;
  return <span className={`flex shrink-0 items-center justify-center rounded-[5px] border bg-muted/40 text-muted-foreground ${header ? "h-7 w-11" : "size-7"}`}><Icon className="size-3.5" aria-hidden /></span>;
}
export function SummaryStrip({ items, label }: { label: string; items: { label: string; value: ReactNode; detail: ReactNode; wrap?: boolean }[] }) {
  return <dl aria-label={label} className={cn("grid shrink-0 grid-cols-2 divide-x border-b", items.length >= 6 ? "lg:grid-cols-3 2xl:grid-cols-6" : items.length === 5 ? "lg:grid-cols-5" : items.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
    {items.map((item) => <Figure key={item.label} smallDecimals {...item} />)}
  </dl>;
}
export type AssetAttention = { label: string; tone: "success" | "attention" | "danger" | "neutral"; detail?: string };
export function AttentionBadge({ status }: { status: AssetAttention }) {
  return <StatusBadge label={status.label} tone={status.tone} line={status.detail} className="h-5 rounded px-1.5 text-[11px]" />;
}

/** The app's empty-state block (Credit Cards / Reconciliation): icon, title, one sentence, then the way out. */
export function EmptyState({ icon: Icon, title, children, action }: { icon: typeof Box; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
    <span className="flex size-11 items-center justify-center rounded-full border bg-muted/40 text-muted-foreground"><Icon className="size-5" aria-hidden /></span>
    <h2 className="mt-1 text-base font-semibold">{title}</h2>
    <p className="max-w-md text-sm text-muted-foreground">{children}</p>
    {action && <div className="mt-2">{action}</div>}
  </div>;
}
