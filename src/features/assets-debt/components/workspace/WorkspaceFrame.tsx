"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, MoreHorizontal } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LOANS_PATH } from "../../lib/routes";
import { FEATURES } from "@/lib/features/catalogue";
import { LoanMenuContent } from "../loan/presentation";
import { LoanGuide, guideSectionForLoanTab, type LoanGuideSection } from "../guide/LoanGuide";

/**
 * The focused loan workspace frame (RD-084 P1.6b T288; FR-206a,
 * `ux-loan-workspace.md` §1–§2). Inside a loan, the Assets & Debt title and
 * section tabs are replaced by this header: a back link that names where it
 * goes, the loan's name and state, one primary action, a ⋯ menu, and five tabs in the order a loan is set up:
 * Terms & Schedule, Link to Actual, Repayments, Loan Ledger, Linked Assets (design spec 06 §4.1). A dot on a tab
 * means it needs the user. Leaving with unsaved changes asks first.
 */

export const WORKSPACE_TABS = [
  { id: "calculation", label: "Terms & Schedule", slug: "schedule" },
  { id: "setup", label: "Link to Actual", slug: "link" },
  { id: "activity", label: "Repayments", slug: "repayments" },
  { id: "ledger", label: "Loan Ledger", slug: "ledger" },
  { id: "assets", label: "Linked Assets", slug: "assets" },
] as const;

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]["id"];

/** The `?view=` value of a tab, in the words the tab shows. */
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
    case "ledger": return "ledger";
    case "assets": return "assets";
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
  /** Tabs that need the user (shown as a dot), with what for. */
  attention?: Partial<Record<WorkspaceTab, string>>;
  /** The one primary action and anything that belongs beside it (the change summary field). */
  actions?: React.ReactNode;
  beforeGuide?: React.ReactNode;
  menu?: WorkspaceMenuItem[];
  dirty: boolean;
  /** Clear any unsaved new-loan state when leaving without saving. */
  onDiscard?: () => void;
  /** Save from the leave dialog; absent when the work cannot be saved yet. */
  onSaveAndLeave?: () => Promise<boolean>;
  children: React.ReactNode;
};

const BACK_HREF = LOANS_PATH;

export function WorkspaceFrame({ title, state, stateEmphasis, tab, onTab, disabledTabs = {}, attention = {}, actions, beforeGuide, menu = [], dirty, onDiscard, onSaveAndLeave, children }: WorkspaceFrameProps) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const leave = () => router.push(BACK_HREF);
  const discardAndLeave = () => { onDiscard?.(); leave(); };
  // The guide opens on the section for the tab you are on.
  const [guide, setGuide] = useState<LoanGuideSection | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-border px-4 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1 text-muted-foreground" onClick={() => (dirty ? setLeaving(true) : discardAndLeave())}>
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Loans
          </Button>
          <h1 className="text-base font-semibold">{title}</h1>
          <span role="status" className={cn("rounded-full border px-2 py-0.5 text-[11px]", stateEmphasis ? "border-primary font-medium" : "border-border text-muted-foreground")}>
            {state}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {beforeGuide}
            <Button type="button" variant="outline" size="sm" onClick={() => setGuide(guideSectionForLoanTab(tab))}><BookOpen className="size-3.5" aria-hidden />Guide</Button>
            {actions}
            {menu.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger aria-label="More loan actions" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  <MoreHorizontal aria-hidden="true" />
                </DropdownMenuTrigger>
                <LoanMenuContent>
                  {menu.map((item) => (
                    <DropdownMenuItem key={item.label} onClick={item.onSelect} className={item.destructive ? "text-destructive" : undefined}>
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </LoanMenuContent>
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
                  "relative border-b-2 border-transparent px-3 py-2 text-xs font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
                  tab === t.id && "border-primary text-foreground"
                )}
              >
                {t.label}
                {attention[t.id] && !disabled ? <span className="absolute top-1.5 right-1 size-1.5 rounded-full bg-staged-updated" role="img" aria-label={attention[t.id]} /> : null}
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
            <Button type="button" variant="outline" className="text-destructive" onClick={discardAndLeave}>Discard changes</Button>
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
      {guide ? <LoanGuide section={guide} onSection={setGuide} onClose={() => setGuide(null)} docsUrl={FEATURES.find((f) => f.id === "loans")?.docsUrl} /> : null}
    </div>
  );
}
