"use client";

import type { ApplyConfig } from "@/lib/reconciliation/session/plan";
import { WriteSetting } from "./WriteSetting";

/**
 * What a statement row becomes when Actual does not have it.
 *
 * Set on the import screen, before matching and before any transformation, and
 * mirrored on the workbench for a change of mind. That placement is the point
 * rather than a convenience: the notes source is an *input* to the
 * transformation engine — a rule reads the note a row is going to carry and
 * writes a new one — so choosing it after transformations have run leaves the
 * transformed rows on the old source while every other row moves. It used to
 * live on the review screen, which is the one place it cannot work from.
 *
 * The bank's merchant text is deliberately absent from these choices: it is
 * always recorded as the transaction's imported payee, whatever the payee and
 * notes end up being (RD-072 §2.2). Both hints say so, because "leave it to
 * your rules" otherwise reads as "throw the bank's text away".
 */
export function NewTransactionOptions({
  config,
  onChange,
  /**
   * How many rows already carry a staged note.
   *
   * Rendered as a caveat where this is offered *after* transformations have
   * run: their notes are settled, and this setting can no longer reach them.
   */
  stagedNotesCount = 0,
}: {
  config: ApplyConfig;
  onChange: (config: ApplyConfig) => void;
  stagedNotesCount?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <WriteSetting
        label="Payee"
        legend="Where a created transaction's payee comes from"
        name="payee-strategy"
        value={config.payeeStrategy}
        onChange={(next) => onChange({ ...config, payeeStrategy: next })}
        options={[
          {
            value: "imported-payee",
            label: "The bank's merchant text",
            hint: "Resolved to a payee, creating one if it is new. A payee you set on a row yourself is always kept, and the bank's text is recorded as the imported payee either way.",
          },
          {
            value: "leave-unset",
            label: "Leave it to your rules",
            hint: "No payee is set, so Actual's rules decide it as the transaction is created. The bank's text is still recorded as the imported payee, so nothing about the statement is lost.",
          },
        ]}
      />

      <WriteSetting
        label="Notes"
        legend="Where a created transaction's notes come from"
        name="notes-strategy"
        value={config.notesStrategy}
        onChange={(next) => onChange({ ...config, notesStrategy: next })}
        options={[
          {
            value: "bank-notes",
            label: "The bank's memo",
            hint: "The statement's own memo field, when it has one. Left empty when it does not.",
          },
          {
            value: "imported-payee",
            label: "Also the merchant text",
            hint: "Falls back to the merchant text when there is no memo - a deliberate duplicate, for rules that read the notes.",
          },
          {
            value: "leave-unset",
            label: "Leave empty",
            hint: "Nothing from the statement goes into the notes.",
          },
        ]}
      />

      {stagedNotesCount > 0 && (
        <p role="status" className="text-[11px] text-muted-foreground">
          {stagedNotesCount} {stagedNotesCount === 1 ? "row has" : "rows have"} notes you have
          already edited or transformed. Those keep what you set - changing the source here only
          affects rows you have not touched.
        </p>
      )}
    </div>
  );
}
