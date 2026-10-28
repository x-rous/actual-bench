import type { EntryType, InstallmentStatus } from "@/lib/assets-debt/tracking/plan";
import type { ComponentProps } from "react";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Shared words and marks for the loan tracking screens (design spec 06 §3). */

export const dt = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "-");

export const ENTRY_LABELS: Record<EntryType, string> = {
  "loan-received": "Loan received",
  "opening-balance": "Opening balance",
  "principal-repayment": "Repayment",
  "extra-principal": "Extra principal",
  "interest-charged": "Interest charged",
  fee: "Fee",
  draw: "Draw",
  adjustment: "Adjustment",
  unclassified: "Unclassified",
};

/** The types a row can be given, by the sign of its amount in the loan account (positive reduces the debt). */
export function entryChoices(amountMinor: number): Exclude<EntryType, "unclassified">[] {
  return amountMinor > 0
    ? ["principal-repayment", "extra-principal", "adjustment"]
    : ["loan-received", "opening-balance", "draw", "interest-charged", "fee", "adjustment"];
}

const STATUS: Record<InstallmentStatus, { label: string; className: string }> = {
  recorded: { label: "Recorded", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  unrecorded: { label: "Unrecorded", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  check: { label: "Check", className: "bg-amber-400/20 text-amber-800 dark:text-amber-300" },
  missing: { label: "Missing", className: "bg-destructive/10 text-destructive" },
  upcoming: { label: "Upcoming", className: "border border-border text-muted-foreground" },
};

export const statusLabel = (status: InstallmentStatus) => STATUS[status].label;

export function StatusBadge({ status }: { status: InstallmentStatus }) {
  return <span className={cn("inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium", STATUS[status].className)}>{STATUS[status].label}</span>;
}

const MENU = "min-w-44 border border-border py-1 shadow-xl [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:px-3 [&_[role=menuitem]]:py-1.5 "
  + "[&_[role=menuitem]]:text-xs [&_[role=menuitem]]:whitespace-nowrap";

/** Compact menu items for the loan screens' ⋯ and action menus (the same size as the credit card row menus). */
export function LoanMenuContent({ className, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent align="end" className={cn(MENU, className)} {...props} />;
}
