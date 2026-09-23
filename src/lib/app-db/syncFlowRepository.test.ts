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
      expect(created.sourceRef).toEqual(sourceRef);
      expect(created.targetRef).toEqual(targetRef);

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
      expect(updated?.options).toEqual(emptyEnvelope);

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

  it("rejects a second leg rather than quietly storing only the first", () => {
    const { root, db } = tempDb();

    try {
      // A flow is one source -> one target. Accepting a two-leg route and
      // persisting half of it is how a sync ends up running against a target
      // the caller never sees in the saved flow - the same silent data loss
      // the v31 migration refuses to perform.
      expect(() =>
        createSyncFlow(db, {
          name: "Two-leg flow",
          legs: [
            { sourceRef, targetRef, filter: emptyEnvelope, transform: emptyEnvelope },
            { sourceRef, targetRef, filter: emptyEnvelope, transform: emptyEnvelope },
          ],
        })
      ).toThrow(AppDbValidationError);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("tolerates an empty legs array the same as legs being absent", () => {
    const { root, db } = tempDb();

    try {
      // Create with no legs at all: falls back to empty envelopes, exactly
      // as a flow with zero sync_flow_legs rows always behaved.
      const created = createSyncFlow(db, { name: "No route yet", legs: [] });
      expect(created.sourceRef).toEqual(emptyEnvelope);
      expect(created.targetRef).toEqual(emptyEnvelope);

      // Update with an empty array: leaves the existing refs untouched rather
      // than erroring, matching legs being omitted entirely. Deliberately not
      // what the old per-leg-row model did (it deleted every leg row, wiping
      // the route) - an omitted value is not a request to clear the route.
      const updated = updateSyncFlow(db, created.id, {
        legs: [{ sourceRef, targetRef, filter: emptyEnvelope, transform: emptyEnvelope }],
      });
      expect(updated?.sourceRef).toEqual(sourceRef);

      const untouched = updateSyncFlow(db, created.id, { name: "Still no new route", legs: [] });
      expect(untouched?.sourceRef).toEqual(sourceRef);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
