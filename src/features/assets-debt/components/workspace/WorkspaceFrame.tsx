"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LOANS_PATH } from "../../lib/routes";

/**
 * The focused loan workspace frame (RD-084 P1.6b T288; FR-206a,
 * `ux-loan-workspace.md` §1–§2). Inside a loan, the Assets & Debt title and
 * section tabs are replaced by this header: a back link that names where it
 * goes, the loan's name and state, one primary action, a ⋯ menu, and exactly
 * three tabs in build order: Terms & Schedule, Link to Actual, Sync Repayments. Leaving with
 * unsaved changes asks first.
 */

export const WORKSPACE_TABS = [
  { id: "calculation", label: "Terms & Schedule", slug: "schedule" },
  { id: "setup", label: "Link to Actual", slug: "link" },
  { id: "activity", label: "Sync Repayments", slug: "repayments" },
] as const;

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]["id"];

/** The `?view=` value of a tab, in the words the tab shows (rev 4: Terms & Schedule · Link to Actual · Sync Repayments). */
export function workspaceTabSlug(tab: WorkspaceTab): string {
  return WORKSPACE_TABS.find((t) => t.id === tab)!.slug;
}

/** `?view=` values, current and old, open the tab that now holds that content. */
export function workspaceTabFor(view: string | null | undefined, fallback: WorkspaceTab): WorkspaceTab {
  switch (view) {
    case "repayments":
    case "transactions":
    case "activity": return "activity";
    case "schedule":
    case "calculation":
    case "simulator": return "calculation";
    case "link":
    case "settings":
    case "setup":
    case "tracking":
    case "matching": return "setup";
    default: return fallback;
  }
}

export type WorkspaceMenuItem = { label: string; onSelect: () => void; destructive?: boolean };

export type WorkspaceFrameProps = {
  title: string;
  /** The state chip: "Not saved yet", "Saved · revision 3", "Unsaved changes", "Archived: read-only". */
  state: string;
  stateEmphasis?: boolean;
  tab: WorkspaceTab;
  onTab: (tab: WorkspaceTab) => void;
  /** Tabs that cannot open yet, with the reason (a new loan has no Activity until it is saved). */
  disabledTabs?: Partial<Record<WorkspaceTab, string>>;
  /** The one primary action and anything that belongs beside it (the change summary field). */
  actions?: React.ReactNode;
  menu?: WorkspaceMenuItem[];
  dirty: boolean;
  /** Save from the leave dialog; absent when the work cannot be saved yet. */
  onSaveAndLeave?: () => Promise<boolean>;
  children: React.ReactNode;
};

const BACK_HREF = LOANS_PATH;

export function WorkspaceFrame({ title, state, stateEmphasis, tab, onTab, disabledTabs = {}, actions, menu = [], dirty, onSaveAndLeave, children }: WorkspaceFrameProps) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const leave = () => router.push(BACK_HREF);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-border px-4 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1 text-muted-foreground" onClick={() => (dirty ? setLeaving(true) : leave())}>
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Loans &amp; Debt
          </Button>
          <h1 className="text-base font-semibold">{title}</h1>
          <span role="status" className={cn("rounded-full border px-2 py-0.5 text-[11px]", stateEmphasis ? "border-primary font-medium" : "border-border text-muted-foreground")}>
            {state}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {actions}
            {menu.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger aria-label="More loan actions" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  <MoreHorizontal aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {menu.map((item) => (
                    <DropdownMenuItem key={item.label} onClick={item.onSelect} className={item.destructive ? "text-destructive" : undefined}>
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        <nav aria-label="Loan sections" className="flex gap-1">
          {WORKSPACE_TABS.map((t) => {
            const disabled = disabledTabs[t.id];
            return (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? "page" : undefined}
                disabled={!!disabled}
                title={disabled}
                onClick={() => onTab(t.id)}
                className={cn(
                  "border-b-2 border-transparent px-3 py-2 text-xs font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
                  tab === t.id && "border-primary text-foreground"
                )}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      <Dialog open={leaving} onOpenChange={(open) => !open && setLeaving(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>This loan has changes that are not saved. Nothing has been written to Actual.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setLeaving(false)}>Stay</Button>
            <Button type="button" variant="outline" className="text-destructive" onClick={leave}>Discard changes</Button>
            {onSaveAndLeave ? (
              <Button
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  const ok = await onSaveAndLeave().finally(() => setSaving(false));
                  if (ok) leave();
                  else setLeaving(false);
                }}
              >
                Save and leave
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
