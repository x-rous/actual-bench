"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PayeePicker } from "@/components/ui/entity-picker";
import type { CategoryItem, PayeeItem } from "@/components/ui/entity-options";
import { canStageField } from "@/lib/reconciliation/session/staging";
import type { StageableField } from "@/lib/reconciliation/session/staging";
import type { ReconciliationItem, StagedPatch } from "@/lib/reconciliation/types";
import { formatMinorUnits } from "../lib/format";
import { Textarea } from "@/components/ui/textarea";

/**
 * Editing the transaction that will result (feature spec §21).
 *
 * The user edits the **final staged transaction**, never the bank row — the
 * statement is a record of what posted, not something to rewrite.
 *
 * Defaults preserve what Actual already holds (feature spec §22): a field with
 * nothing staged shows the existing value and produces no write. Notes in
 * particular are never seeded from the statement description, because the bank's
 * text is not worth more than whatever the user wrote there.
 */

/** A payee or category: what the panels name, plus what the pickers group by. */
export type Option = PayeeItem & CategoryItem;

export type StagedFieldsProps = {
  item: ReconciliationItem;
  /** Values as they are in Actual today; null for a row being created. */
  current: { payeeId: string | null; categoryId: string | null; notes: string | null };
  payees: Option[];
  categories: Option[];
  onStage: (field: StageableField, value: string | null) => void;
  onUnstage: (field: StageableField) => void;
};

function ChangedMark({
  patch,
  field,
  onUnstage,
}: {
  patch: StagedPatch | undefined;
  field: StageableField;
  onUnstage: () => void;
}) {
  if (!patch?.[field]) return null;
  return (
    <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
      changed
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4"
        aria-label={`Undo the change to ${field}`}
        onClick={onUnstage}
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
    </span>
  );
}

export function StagedFields({
  item,
  current,
  payees,
  categories,
  onStage,
  onUnstage,
}: StagedFieldsProps) {
  const patch = item.stagedChanges;
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  const payeeValue = (patch?.payeeId ? patch.payeeId.staged : current.payeeId) ?? "";
  const notesValue = notesDraft ?? ((patch?.notes ? patch.notes.staged : current.notes) ?? "");

  const payeeGuard = canStageField(item, "payeeId");
  const notesGuard = canStageField(item, "notes");
  const sharedRestriction = !payeeGuard.allowed && !notesGuard.allowed && payeeGuard.reason === notesGuard.reason
    ? payeeGuard.reason : null;

  return (
    <section aria-label="Resulting transaction" className="space-y-3 rounded-lg border border-border/60 bg-background p-3">
      <h4 className="text-xs font-semibold">
        Resulting transaction
      </h4>

      {sharedRestriction && <p className="text-[11px] text-muted-foreground">{sharedRestriction}</p>}
      {patch?.date && (
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-2.5 text-xs">
          <span className="text-muted-foreground">Date</span>
          <div>
            <p className="text-amber-600 dark:text-amber-400">{patch.date.original} → {patch.date.staged}</p>
            <Button size="sm" variant="ghost" className="mt-1 h-6 px-1 text-[11px]" onClick={() => onUnstage("date")}>Undo date</Button>
          </div>
        </div>
      )}

      {patch?.amount && (
        <div className="rounded-md border border-amber-500/40 px-2.5 py-2 text-xs">
          <p className="font-medium">Amount will change</p>
          <p className="text-muted-foreground">
            {formatMinorUnits(patch.amount.original)} → {formatMinorUnits(patch.amount.staged)}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-6 px-1 text-[11px]"
            onClick={() => onUnstage("amount")}
          >
            Leave the amount as it is
          </Button>
        </div>
      )}

      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2.5">
        <Label className="text-xs text-muted-foreground">Payee</Label>
        <div className="min-w-0 space-y-1">
          {payeeGuard.allowed ? (
            <PayeePicker payees={payees} value={payeeValue}
              onChange={(next) => onStage("payeeId", next || null)} placeholder="No payee"
              ariaLabel="Payee" allowNone noneLabel="No payee" />
          ) : <p className="py-1 text-xs">{payees.find((payee) => payee.id === payeeValue)?.name ?? "No payee"}</p>}
          <ChangedMark patch={patch} field="payeeId" onUnstage={() => onUnstage("payeeId")} />
          {!payeeGuard.allowed && !sharedRestriction && <p className="text-[11px] text-muted-foreground">{payeeGuard.reason}</p>}
        </div>
      </div>

      {/*
        Category is shown but not editable. Categorising belongs in Actual,
        where the rules and the budget context are; a reconciliation confirms
        what posted. It is displayed so the user can see what the transaction
        already carries and know it is being left alone.
      */}
      {/* Laid out as a fact rather than as a field: label beside value on one
          line, so it reads as something being reported rather than a control
          the user is hunting for the edit affordance on. */}
      <div
        className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2.5"
        title="Categories are set in Actual, where the rules and the budget context are. A reconciliation never changes them."
      >
        <span className="text-xs text-muted-foreground">
          Category
        </span>
        <p className="text-xs">
          {categories.find((option) => option.id === current.categoryId)?.name ?? "-"}
        </p>
      </div>

      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-2.5">
        <Label htmlFor="staged-notes" className="pt-2 text-xs text-muted-foreground">Notes</Label>
        <div className="min-w-0 space-y-1">
          <Textarea id="staged-notes" rows={2} className="min-h-16 text-xs"
            value={notesValue} disabled={!notesGuard.allowed}
            onChange={(event) => setNotesDraft(event.target.value)}
            // Persist the complete edit on blur, rather than every keystroke.
            onBlur={() => {
              if (notesDraft !== null) { onStage("notes", notesDraft || null); setNotesDraft(null); }
            }} />
          <ChangedMark patch={patch} field="notes" onUnstage={() => onUnstage("notes")} />
          {!notesGuard.allowed && !sharedRestriction && <p className="text-[11px] text-muted-foreground">{notesGuard.reason}</p>}
        </div>
      </div>
    </section>
  );
}
