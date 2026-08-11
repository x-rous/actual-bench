"use client";

import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Moving between the phases of a reconciliation.
 *
 * The phase buttons used to live wherever each screen happened to put them —
 * the bottom of the import panel, the right of the workbench's tool row, above
 * the review table — so "how do I go on" and "how do I go back" had a different
 * answer on every screen.
 *
 * They now sit in one place, in a fixed order: leaving on the left, the next
 * phase on the right, with the primary action always last. Tools that act on
 * the current screen rather than moving between phases (re-run, transform,
 * matching options) deliberately stay where they are — they are not navigation.
 */

export type PhaseNavProps = {
  /** Leaves the phase. Labelled with where it goes, never just "Back". */
  back?: { label: string; onClick: () => void; disabled?: boolean };
  /** A second way out, offered where one exists — e.g. re-importing. */
  secondary?: { label: string; onClick: () => void; disabled?: boolean; title?: string };
  /** The next phase. Absent on the last one. */
  next?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    busy?: boolean;
    /** Shown beside the button while it works, since a spinner cannot say how far. */
    progress?: string | null;
  };
};

export function PhaseNav({ back, secondary, next }: PhaseNavProps) {
  return (
    <>
      {next?.progress && (
        <span className="mr-1 text-xs tabular-nums text-muted-foreground">{next.progress}</span>
      )}
      {back && (
        <Button variant="ghost" size="sm" onClick={back.onClick} disabled={back.disabled}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          {back.label}
        </Button>
      )}
      {secondary && (
        <Button
          variant="outline"
          size="sm"
          onClick={secondary.onClick}
          disabled={secondary.disabled}
          title={secondary.title}
        >
          {secondary.label}
        </Button>
      )}
      {next && (
        <Button size="sm" onClick={next.onClick} disabled={next.disabled || next.busy}>
          {next.busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {next.label}
          {!next.busy && <ArrowRight className="ml-1 h-3.5 w-3.5" />}
        </Button>
      )}
    </>
  );
}
