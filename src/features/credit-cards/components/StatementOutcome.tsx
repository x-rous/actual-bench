"use client";
import type { StatementOutcome as Outcome } from "../lib/paymentSummary";
import { ReviewText } from "./ReviewText";
import { Status } from "./WorkspaceVisuals";

/** One rendering contract wherever a statement outcome appears. */
export function StatementOutcome({ outcome, label = "statement outcome", compact = false }: { outcome: Outcome; label?: string; compact?: boolean }) {
  return <ReviewText text={outcome.label} detail={outcome.detail} label={label} className={compact ? "w-fit max-w-full" : "w-fit max-w-full whitespace-normal"}><Status tone={outcome.tone} className={compact ? "h-auto max-w-full text-left" : "h-auto max-w-full justify-start whitespace-normal text-left"}>{compact ? <span className="truncate">{outcome.label}</span> : outcome.label}</Status></ReviewText>;
}
