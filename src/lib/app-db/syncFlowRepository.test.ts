import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import {
  createSyncFlow,
  deleteSyncFlow,
  getSyncFlow,
  listSyncFlows,
  updateSyncFlow,
} from "./syncFlowRepository";
import type { JsonEnvelope, SqliteDatabase } from "./types";

const emptyEnvelope: JsonEnvelope = { version: 1, data: {} };
const sourceRef: JsonEnvelope = { version: 1, data: { connectionRef: "source", budgetSyncId: "budget-a" } };
const targetRef: JsonEnvelope = { version: 1, data: { connectionRef: "target", budgetSyncId: "budget-b" } };

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-flow-db-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

describe("sync flow repository", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("creates, lists, updates, and deletes sync flow definitions", () => {
    const { root, db } = tempDb();

    try {
      const created = createSyncFlow(db, {
        name: "Rent reimbursement",
        description: "Mirror reimbursement transactions",
        legs: [
          {
            sourceRef,
            targetRef,
            filter: { version: 1, data: { payee: "Landlord" } },
            transform: { version: 1, data: { amount: "reverse", notesPrefix: "Synced" } },
            options: { version: 1, data: { autoCreatePayees: true } },
          },
        ],
      });

      expect(created.name).toBe("Rent reimbursement");
      expect(created.enabled).toBe(true);
      expect(created.flowType).toBe("transaction_sync");
      expect(created.legs).toHaveLength(1);
      expect(created.legs[0]?.position).toBe(0);

      expect(listSyncFlows(db)).toHaveLength(1);

      const updated = updateSyncFlow(db, created.id, {
        name: "Rent mirror",
        enabled: false,
        flowType: "payee_sync",
        description: null,
        legs: [
          {
            sourceRef,
            targetRef,
            filter: emptyEnvelope,
            transform: { version: 1, data: { category: "empty" } },
          },
        ],
      });

      expect(updated?.name).toBe("Rent mirror");
      expect(updated?.enabled).toBe(false);
      expect(updated?.flowType).toBe("payee_sync");
      expect(updated?.description).toBeNull();
      expect(updated?.legs[0]?.options).toEqual(emptyEnvelope);

      expect(deleteSyncFlow(db, created.id)).toBe(true);
      expect(getSyncFlow(db, created.id)).toBeNull();
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects secret-like fields in persisted metadata", () => {
    const { root, db } = tempDb();

    try {
      expect(() =>
        createSyncFlow(db, {
          name: "Unsafe flow",
          legs: [
            {
              sourceRef: { version: 1, data: { apiKey: "secret" } },
              targetRef,
              filter: emptyEnvelope,
              transform: emptyEnvelope,
            },
          ],
        })
      ).toThrow(AppDbValidationError);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
