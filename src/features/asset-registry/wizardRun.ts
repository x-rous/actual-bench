import { bankToday } from "@/features/credit-cards/lib/cycles";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import { executeAction, freshActionContext, prepareAction, writeTypeTags, type ActionContext } from "@/lib/asset-registry/actions";
import { capitalEvidence, capitalMetadata, executeCapital, prepareCapital, type CapitalContext, type CapitalInput } from "@/lib/asset-registry/capitalActions";
import { readExternal, sourceEvidence } from "@/lib/asset-registry/cashflows";
import type { BookType, Registry } from "@/lib/asset-registry/models";
import { withTypeTag } from "@/lib/asset-registry/tags";
import type { PurchasePlan } from "./wizardPlan";
import { registryRequest } from "./api";

export type RunContext = { transport: ActualBenchTransport; assetId: string; budgetSyncId: string; /** True when the asset shares its account, so its rows must be assigned to it. */ shared: boolean };
const today = () => bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone);

async function actionContext(ctx: RunContext, date: string): Promise<ActionContext> {
  return freshActionContext(ctx.transport, ctx.assetId, date, () => registryRequest(ctx.budgetSyncId));
}
async function capitalContext(ctx: RunContext, date: string, accountIds: string[]): Promise<CapitalContext> {
  const base = await actionContext(ctx, date);
  const bookIds = [...new Set(base.registry.assets.map((a) => a.actualAccountId))];
  return { ...base, external: await readExternal(ctx.transport, bookIds, accountIds) };
}
const classify = (ctx: RunContext, context: ActionContext, rowId: string, classification: BookType): Promise<Registry> => registryRequest(ctx.budgetSyncId, "PATCH", {
  changes: [{ actualTransactionId: rowId, actualAccountId: context.asset.actualAccountId, assetId: ctx.shared ? ctx.assetId : null, classification, revision: context.registry.metadata.find((m) => m.actualTransactionId === rowId)?.revision ?? 0 }],
});

/**
 * Carries out the wizard's purchase plan on the saved asset with the same safeguards as the standalone actions. Anything
 * that writes to Actual happens before this resolves; `commit` then records the relationship in Bench and can be repeated
 * on its own if it fails, so Actual is never written twice.
 */
export async function startPurchase(plan: PurchasePlan, ctx: RunContext): Promise<{ commit: () => Promise<Registry> } | null> {
  switch (plan.kind) {
    case "skip": return null;
    case "expense": case "new-purchase": {
      const date = plan.kind === "expense" ? plan.source.date : plan.date;
      const touched = [plan.kind === "expense" ? plan.source.accountId : plan.fromAccountId];
      const input: CapitalInput = plan.kind === "expense"
        ? { kind: "capitalize", date, notes: `Capitalized: ${plan.source.payeeName ?? "expense"} ${date}`, sourceId: plan.source.id }
        : { kind: "acquire", date, notes: plan.notes, sourceAccountId: plan.fromAccountId, categoryId: plan.categoryId, amountMinor: plan.amountMinor, paymentNotRecorded: true };
      const prepared = prepareCapital(await capitalContext(ctx, date, touched), input);
      const result = await executeCapital(prepared, () => capitalContext(ctx, date, touched));
      return { commit: async () => registryRequest(ctx.budgetSyncId, "PUT", { changes: capitalMetadata(prepared, result), sources: sourceEvidence(capitalEvidence(await capitalContext(ctx, date, touched))) }) };
    }
    case "opening-new": {
      const context = await actionContext(ctx, plan.date);
      const prepared = prepareAction(context, { kind: "create", date: plan.date, amountMinor: plan.amountMinor, notes: withTypeTag(plan.notes, "opening-balance"), payeeId: null });
      const result = await executeAction(prepared, () => actionContext(ctx, plan.date));
      return { commit: async () => registryRequest(ctx.budgetSyncId, "PATCH", { changes: [{ actualTransactionId: result.transactionId!, actualAccountId: context.asset.actualAccountId, assetId: ctx.shared ? ctx.assetId : null, classification: "opening-balance", revision: 0 }] }) };
    }
    case "transfer": case "opening-existing": {
      const type: BookType = plan.kind === "transfer" ? "acquisition" : "opening-balance";
      return { commit: async () => {
        const context = await actionContext(ctx, today());
        const rowId = plan.row.id;
        await writeTypeTags(context, [rowId], type); // protected rows (transfers) are skipped and stay Bench-only
        return classify(ctx, context, rowId, type);
      } };
    }
  }
}
