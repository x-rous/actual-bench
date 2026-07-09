jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { getAllSyncMappingsForFlow } from "@/lib/app-db/syncMappingRepository";
import { POST } from "./route";
import type { SyncMapping, SyncMappingInput } from "@/lib/app-db/types";

const envelope = { version: 1, data: {} };

function request(body: unknown): Request {
  return { json: async () => body } as Request;
}

function mappingInput(flowId: string, sourceItemKey: string): SyncMappingInput {
  return {
    flowId,
    sourceConnectionFingerprint: "source-fp",
    sourceBudgetId: "budget-a",
    sourceAccountId: "account-a",
    sourceEntityType: "transaction",
    sourceTransactionId: sourceItemKey.split(":")[1] ?? "t",
    sourceSplitId: null,
    sourceItemKey,
    sourceFingerprint: "source-hash",
    targetConnectionFingerprint: "target-fp",
    targetBudgetId: "budget-b",
    targetAccountId: "account-b",
    targetEntityType: "transaction",
    targetTransactionId: "tt-" + sourceItemKey,
    targetItemKey: "txn:tt-" + sourceItemKey,
    targetFingerprint: null,
    targetMarker: "absync:budget-a:budget-b:account-b:" + sourceItemKey,
    createdRunId: null,
  };
}

describe("/api/sync-mappings POST", () => {
  let root: string;
  let flowId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-mappings-route-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    flowId = createSyncFlow(getAppDb(), {
      name: "Card sync",
      legs: [{ sourceRef: envelope, targetRef: envelope, filter: envelope, transform: envelope }],
    }).id;
  });

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    rmSync(root, { recursive: true, force: true });
  });

  it("bulk-creates an array of mappings in one request", async () => {
    const response = await POST(request([mappingInput(flowId, "txn:a"), mappingInput(flowId, "txn:b"), mappingInput(flowId, "txn:c")]));
    const body = (await response.json()) as { mappings: SyncMapping[] };
    expect(response.status).toBe(201);
    expect(body.mappings).toHaveLength(3);
    expect(getAllSyncMappingsForFlow(getAppDb(), flowId)).toHaveLength(3);
  });

  it("still accepts a single mapping object", async () => {
    const response = await POST(request(mappingInput(flowId, "txn:solo")));
    const body = (await response.json()) as { mapping: SyncMapping };
    expect(body.mapping.sourceItemKey).toBe("txn:solo");
    expect(getAllSyncMappingsForFlow(getAppDb(), flowId)).toHaveLength(1);
  });
});
