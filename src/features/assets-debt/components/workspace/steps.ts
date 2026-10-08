import type { PostingView } from "@/lib/assets-debt/services/proposalService";

/** T278: a split and the lender link that continues it are two steps of one flow, each applied on its own. */
export type PostingStep = { index: 1 | 2; total: 2; title: string; note: string };

/**
 * T278: with a lender feed, Pattern A is two explicit steps for one period:
 * split the payment, then link the split's principal line and the lender's
 * row. Each keeps its own Apply; this only names and orders them.
 */
export function stepsOf(postings: readonly PostingView[]): Map<string, PostingStep> {
  const out = new Map<string, PostingStep>();
  const live = postings.filter((p) => !["superseded", "declined", "reversed"].includes(String(p.status)));
  for (const split of live.filter((p) => p.postingKind === "repayment-split" && p.output.kind === "restructure")) {
    if (split.output.kind !== "restructure") continue;
    const principal = split.output.operations.find((c) => c.economicKind === "principal");
    if (!principal || principal.transferAccountId) continue; // No lender feed: one step only.
    const link = live.find((p) => p.postingKind === "repayment-link" && p.periodKey === split.periodKey && p.output.kind === "link");
    out.set(split.id, {
      index: 1, total: 2, title: "Split the payment",
      note: split.status === "applied"
        ? link ? "Done. Step 2 links the principal line and the lender's row." : "Done. Step 2 appears when the lender's row arrives in Actual."
        : "Apply this first. Step 2 then links the principal line and the lender's row.",
    });
    if (link) out.set(link.id, { index: 2, total: 2, title: "Link the lender's row", note: "Makes the split's principal line and the lender's row the two sides of one transfer. Apply it on its own." });
  }
  return out;
}
