"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InvertedSignDiagnosis } from "@/lib/reconciliation/session/invertedSigns";

/**
 * Why nothing matched, said where the nothing is visible.
 *
 * Sits directly under the coverage bars because that is where someone looks to
 * learn how matching went, and on this session those bars read zero across the
 * board. A zero with no explanation reads as the wrong account or the wrong
 * period; the explanation is the whole point.
 *
 * **The button is the value, not the sentence.** Recovering from an inverted
 * statement otherwise means going back to Import, re-picking the file, finding
 * the sign-convention setting and guessing among its options. Re-matching
 * already exists, so offering it here with the rows flipped costs almost
 * nothing and turns that into one click.
 */

export type InvertedSignsNoticeProps = {
  diagnosis: InvertedSignDiagnosis;
  onRerun: () => void;
  /** Re-running is already in flight. */
  isMatching?: boolean;
  /** Why re-running is refused - an applied session cannot be re-matched. */
  blockedReason?: string | null;
};

export function InvertedSignsNotice({
  diagnosis,
  onRerun,
  isMatching,
  blockedReason,
}: InvertedSignsNoticeProps) {
  return (
    <div
      role="status"
      className="mt-2 flex flex-wrap items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2"
    >
      <TriangleAlert
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Nothing matched, and the amounts look inverted.</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Your statement shows spend as a positive number; Actual stores it as negative.{" "}
          {diagnosis.wouldMatch} of {diagnosis.statementRows} rows would match if the sign were
          flipped.
        </p>
      </div>

      {/*
        The reason is rendered, not hung on a `title`.
        
        A disabled button is not focusable, so a tooltip on one is unreachable
        by keyboard and unread by a screen reader - the refusal would be
        announced as nothing at all. `aria-describedby` ties the text to the
        button so it is announced with it, and it stays visible for everyone
        else, which is the same treatment the row inspector gives a refused
        action.
      */}
      <div className="flex flex-col items-end gap-0.5">
        <Button
          size="sm"
          variant="outline"
          onClick={onRerun}
          disabled={isMatching || Boolean(blockedReason)}
          aria-describedby={blockedReason ? "inverted-signs-blocked" : undefined}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Re-run inverted
        </Button>
        {blockedReason && (
          <p id="inverted-signs-blocked" className="text-[11px] text-muted-foreground">
            {blockedReason}
          </p>
        )}
      </div>
    </div>
  );
}
