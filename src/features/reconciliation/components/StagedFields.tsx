"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { canStageField } from "@/lib/reconciliation/session/staging";
import type { StageableField } from "@/lib/reconciliation/session/staging";
import type { ReconciliationItem, StagedPatch } from "@/lib/reconciliation/types";
import { formatMinorUnits } from "../lib/format";

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

export type Option = { id: string; name: string };

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

  const payeeValue = patch?.payeeId?.staged ?? current.payeeId ?? "";
  const notesValue = notesDraft ?? patch?.notes?.staged ?? current.notes ?? "";

  const field = (name: StageableField) => canStageField(item, name);

  return (
    <section className="flex flex-col gap-3 border-t border-border/50 pt-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide">
        Resulting transaction
      </h4>

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

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="staged-payee" className="text-[11px] uppercase tracking-wide">
            Payee
          </Label>
          <ChangedMark patch={patch} field="payeeId" onUnstage={() => onUnstage("payeeId")} />
        </div>
        <select
          id="staged-payee"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
          value={payeeValue}
          disabled={!field("payeeId").allowed}
          onChange={(event) => onStage("payeeId", event.target.value || null)}
        >
          <option value="">No payee</option>
          {payees.map((payee) => (
            <option key={payee.id} value={payee.id}>
              {payee.name}
            </option>
          ))}
        </select>
        {!field("payeeId").allowed && (
          <p className="text-[11px] text-muted-foreground">
            {(field("payeeId") as { reason: string }).reason}
          </p>
        )}
      </div>

      {/*
        Category is shown but not editable. Categorising belongs in Actual,
        where the rules and the budget context are; a reconciliation confirms
        what posted. It is displayed so the user can see what the transaction
        already carries and know it is being left alone.
      */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Category
        </span>
        <p className="text-xs">
          {categories.find((option) => option.id === current.categoryId)?.name ?? "—"}
          <span className="ml-1 text-muted-foreground">· set in Actual</span>
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="staged-notes" className="text-[11px] uppercase tracking-wide">
            Notes
          </Label>
          <ChangedMark patch={patch} field="notes" onUnstage={() => onUnstage("notes")} />
        </div>
        <textarea
          id="staged-notes"
          rows={3}
          className="rounded-md border border-input bg-background p-2 text-xs disabled:opacity-50"
          value={notesValue}
          disabled={!field("notes").allowed}
          onChange={(event) => setNotesDraft(event.target.value)}
          // Committed on blur rather than per keystroke: every commit persists,
          // and a note is edited as a whole thought rather than a character.
          onBlur={() => {
            if (notesDraft !== null) {
              onStage("notes", notesDraft || null);
              setNotesDraft(null);
            }
          }}
        />
        {!field("notes").allowed && (
          <p className="text-[11px] text-muted-foreground">
            {(field("notes") as { reason: string }).reason}
          </p>
        )}
      </div>
    </section>
  );
}
