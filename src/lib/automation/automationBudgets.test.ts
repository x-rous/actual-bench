import type { AutomationDefinition, SyncCredentialMeta } from "@/lib/app-db/types";
import { automationBudgets } from "./automationBudgets";

const policies: Record<string, unknown> = {};
const flows: Record<string, unknown> = {};
jest.mock("@/lib/app-db/backupRepository", () => ({ getBackupPolicy: (_db: unknown, id: string) => policies[id] ?? null }));
jest.mock("@/lib/app-db/syncFlowRepository", () => ({ getSyncFlow: (_db: unknown, id: string) => flows[id] ?? null }));
jest.mock("@/lib/credentials/unattendedCredentials", () => ({ listSyncCredentialMeta: () => [] }));

const db = {} as never;

const enrolments = [
  { connectionFingerprint: "fp-home", label: "Household", budgetSyncId: "sync-home" },
  { connectionFingerprint: "fp-joint", label: "", budgetSyncId: "sync-joint" },
] as SyncCredentialMeta[];

function automation(type: string, fields: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    type,
    credentialRef: null,
    targetRef: { version: 1, data: {} },
    config: { version: 1, data: {} },
    ...fields,
  } as AutomationDefinition;
}

describe("automationBudgets", () => {
  it("names a bank sync's budget from its enrolment", () => {
    const bankSync = automation("bank-sync", { config: { version: 1, data: { connectionFingerprint: "fp-home" } } });
    expect(automationBudgets(db, bankSync, enrolments)).toEqual(["Household"]);
  });

  it("names a backup's budget through its policy, falling back to the sync id", () => {
    policies["policy-1"] = { sourceRef: { version: 1, data: { connectionFingerprint: "fp-joint" } } };
    const backup = automation("backup", { targetRef: { version: 1, data: { policyId: "policy-1" } } });
    expect(automationBudgets(db, backup, enrolments)).toEqual(["sync-joint"]);
  });

  it("names a Budget File Sync's source then target", () => {
    flows["flow-1"] = {
      sourceRef: { version: 1, data: { budgetName: "Household", connectionFingerprint: "fp-home" } },
      targetRef: { version: 1, data: { connectionFingerprint: "fp-joint" } },
    };
    const sync = automation("budget-file-sync", { targetRef: { version: 1, data: { flowId: "flow-1" } } });
    expect(automationBudgets(db, sync, enrolments)).toEqual(["Household", "sync-joint"]);
  });

  it("doesn't show a server-run sync's stored name once its enrolment is gone", () => {
    flows["flow-2"] = {
      sourceRef: { version: 1, data: { budgetName: "Household", connectionFingerprint: "fp-gone" } },
      targetRef: { version: 1, data: { budgetName: "Joint", connectionFingerprint: "fp-joint" } },
    };
    const serverRun = automation("budget-file-sync", {
      executionMode: "server",
      targetRef: { version: 1, data: { flowId: "flow-2" } },
    });
    expect(automationBudgets(db, serverRun, enrolments)).toEqual([null, "Joint"]);
    // Run in the browser, it uses the tab's own connections: the name stands.
    const browserRun = { ...serverRun, executionMode: "browser" } as AutomationDefinition;
    expect(automationBudgets(db, browserRun, enrolments)).toEqual(["Household", "Joint"]);
  });

  it("marks a budget that can no longer be found", () => {
    const bankSync = automation("bank-sync", { config: { version: 1, data: { connectionFingerprint: "fp-gone" } } });
    expect(automationBudgets(db, bankSync, enrolments)).toEqual([null]);
    const sync = automation("budget-file-sync", { targetRef: { version: 1, data: { flowId: "missing" } } });
    expect(automationBudgets(db, sync, enrolments)).toEqual([null, null]);
  });

  it("names no budget for verifying stored backups", () => {
    expect(automationBudgets(db, automation("backup-scrub"), enrolments)).toEqual([]);
  });
});
