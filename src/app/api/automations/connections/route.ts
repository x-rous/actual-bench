import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { listAutomations } from "@/lib/app-db/automationRepository";
import { listSyncCredentialMeta } from "@/lib/app-db/syncCredentialRepository";
import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { listAutomationJobTypes } from "@/lib/automation/registry";
import { vaultEnabled } from "@/lib/sync/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Which budgets Bench may act on while nobody is watching, and what depends on
 * each one.
 *
 * The "used by" part is the reason this exists as its own endpoint rather than
 * the raw credential list: withdrawing a credential stops every automation that
 * names it, and today nothing tells anyone that before they do it. The engine
 * fails closed and pauses with a reason, which is right - but it should not be
 * a surprise.
 */
export async function GET() {
  try {
    ensureAutomationJobTypesRegistered();
    const db = getAppDb();

    if (!vaultEnabled()) {
      return NextResponse.json({ vaultEnabled: false, connections: [] });
    }

    const automations = listAutomations(db);
    const typeLabels = new Map(listAutomationJobTypes().map((jobType) => [jobType.type, jobType.label]));

    return NextResponse.json({
      vaultEnabled: true,
      connections: listSyncCredentialMeta(db).map((credential) => ({
        connectionFingerprint: credential.connectionFingerprint,
        label: credential.label || credential.baseUrl,
        baseUrl: credential.baseUrl,
        budgetSyncId: credential.budgetSyncId,
        mode: credential.mode,
        enrolledAt: credential.createdAt,
        usedBy: automations
          .filter((automation) => automation.credentialRef === credential.connectionFingerprint)
          .map((automation) => ({
            id: automation.id,
            name: automation.name,
            type: automation.type,
            typeLabel: typeLabels.get(automation.type) ?? automation.type,
            enabled: automation.enabled,
          })),
      })),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
