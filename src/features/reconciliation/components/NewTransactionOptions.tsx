"use client";

import { InfoHint } from "@/components/ui/info-hint";
import type { ApplyConfig } from "@/lib/reconciliation/session/plan";
import type { StatementFormat } from "@/lib/reconciliation/statement/normalize";
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
 * One vocabulary throughout: **the statement's payee** and **the statement's
 * memo**, which are the words on the preview columns beside this. The screen
 * used to call the first of those three different things, none of which was the
 * name of the column showing it (F-129).
 *
 * The statement's payee is recorded as the transaction's imported payee
 * whatever these choices are (RD-072 §2.2), which is why the payee hints say so
 * — "leave it to your rules" otherwise reads as "throw the bank's text away".
 */
export function NewTransactionOptions({
  config,
  onChange,
  statementFormat = null,
  /**
   * How many rows already carry a staged note.
   *
   * Rendered as a caveat where this is offered *after* transformations have
   * run: their notes are settled, and this setting can no longer reach them.
   */
  stagedNotesCount = 0,
  disabled = false,
}: {
  config: ApplyConfig;
  onChange: (config: ApplyConfig) => void;
  /** Null on a session recorded before the format was stored. */
  statementFormat?: StatementFormat | null;
  stagedNotesCount?: number;
  /** Keep the choices visible as an audit record once Apply has started. */
  disabled?: boolean;
}) {
  /*
   * On a delimited statement the column mapping already answers "where do notes
   * come from", and the preview proves it. Offering a second control here meant
   * "leave empty" could silently override a column the user had just mapped and
   * watched populate (F-128). Actual hides its own notes checkbox for CSV for
   * the same reason.
   *
   * The stored values are ignored rather than rewritten — see `resolveNotes`.
   * Rewriting them would lose the choice a user made for an OFX statement the
   * moment they re-imported the same session from a CSV.
   */
  const notesFromMapping = statementFormat === "delimited";

  return (
    <div className="flex flex-col gap-2">
      <WriteSetting
        label="Payee"
        legend="Where a created transaction's payee comes from"
        name="payee-strategy"
        value={config.payeeStrategy}
        disabled={disabled}
        onChange={(next) => onChange({ ...config, payeeStrategy: next })}
        options={[
          {
            value: "imported-payee",
            label: "The statement's payee",
            hint: "Resolved to a payee, creating one if it is new. A payee you set on a row yourself is always kept, and the statement's payee is recorded as the imported payee either way.",
          },
          {
            value: "leave-unset",
            label: "Leave it to your rules",
            hint: "No payee is set, so Actual's rules decide it as the transaction is created. The statement's payee is still recorded as the imported payee, so nothing about the statement is lost.",
          },
        ]}
      />

      <section className="rounded-md border border-border/60 px-3 py-2">
        <fieldset disabled={disabled} className="flex flex-col gap-1.5">
          <legend className="sr-only">
            What a created transaction&apos;s notes are built from
          </legend>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Notes</span>
            <InfoHint label="notes">
              Tick both to keep the memo and the payee, separated by an em dash. Notes you have
              already edited or transformed keep what you set.
            </InfoHint>
          </div>

          {notesFromMapping ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              From the <span className="font-medium">Notes</span> column you mapped above the
              preview. Leave that column unmapped for empty notes.
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-foreground"
                  checked={config.notesFromMemo}
                  onChange={(event) => onChange({ ...config, notesFromMemo: event.target.checked })}
                />
                <span className="flex items-center gap-1.5">
                  Use the statement&apos;s memo
                  <InfoHint label="using the statement's memo">
                    The file&apos;s own memo field. Left out when a row has none.
                  </InfoHint>
                </span>
              </label>

              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-foreground"
                  checked={config.notesIncludePayee}
                  onChange={(event) =>
                    onChange({ ...config, notesIncludePayee: event.target.checked })
                  }
                />
                <span className="flex items-center gap-1.5">
                  Also include the statement&apos;s payee
                  <InfoHint label="including the statement's payee">
                    A deliberate duplicate, for rules that match on the notes rather than the payee.
                  </InfoHint>
                </span>
              </label>
            </>
          )}
        </fieldset>
      </section>

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
