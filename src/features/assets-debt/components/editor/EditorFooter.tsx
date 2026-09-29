"use client";

import { Button } from "@/components/ui/button";

/**
 * The save boundary (FR-002, US1 scenario 2): shown on every surface that
 * saves debt configuration, so nobody mistakes a save for a posting.
 */
export const SAVE_BOUNDARY_NOTICE = "Saving these settings does not create or modify financial transactions.";

export function SaveBoundaryNotice() {
  return (
    <p className="text-xs text-muted-foreground" data-testid="save-boundary-notice">
      {SAVE_BOUNDARY_NOTICE}
    </p>
  );
}

/** Without `onSave`, the save button submits the surrounding form. */
export function EditorFooter({ saving, onSave, onCancel, saveLabel = "Save" }: { saving: boolean; onSave?: () => void; onCancel?: () => void; saveLabel?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-3">
      <SaveBoundaryNotice />
      <div className="flex gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
        <Button type={onSave ? "button" : "submit"} onClick={onSave} disabled={saving} aria-busy={saving || undefined}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
