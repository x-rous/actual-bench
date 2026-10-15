"use client";
import type { StatementOutcome as Outcome } from "../lib/paymentSummary";
import { ReviewText } from "./ReviewText";
import { Status } from "./WorkspaceVisuals";

/** One rendering contract wherever a statement outcome appears. */
export function StatementOutcome({ outcome, label = "statement outcome" }: { outcome: Outcome; label?: string }) {
  return <ReviewText text={outcome.label} detail={outcome.detail} label={label} className="w-fit max-w-full whitespace-normal">{outcome.tone === "neutral" || outcome.tone === "success" ? <span className="text-xs text-muted-foreground">{outcome.label}</span> : <Status tone={outcome.tone} className="h-auto max-w-full justify-start whitespace-normal text-left">{outcome.label}</Status>}</ReviewText>;
}
