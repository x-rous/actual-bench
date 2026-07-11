import { auditFileName, buildRunAuditCsv, buildRunAuditJson, toAuditRecord } from "./runAudit";
import type { PreviewRow } from "./previewRows";

function row(overrides: Partial<PreviewRow> = {}): PreviewRow {
  return {
    id: "i1",
    classification: "new",
    plannedAction: "create",
    entityType: "transaction",
    group: "new",
    selectable: true,
    isSafeNew: true,
    reviewRequired: false,
    applyState: "applied",
    sourceItemKey: "txn:t1",
    isSplit: false,
    flags: ["target_rules_may_modify"],
    message: null,
    source: { date: "2026-07-01", amount: -1250, payeeName: "Coffee, Bar", categoryName: "Dining", notes: null },
    target: { date: "2026-07-01", amount: 1250, payeeName: "Coffee, Bar", categoryName: "tc1", notes: null },
    ...overrides,
  };
}

describe("runAudit", () => {
  it("maps a preview row to a flat audit record", () => {
    const rec = toAuditRecord(row());
    expect(rec.sourceItemKey).toBe("txn:t1");
    expect(rec.classification).toBe("new");
    expect(rec.plannedAction).toBe("create");
    expect(rec.applyState).toBe("applied");
    expect(rec.sourceAmount).toBe("-12.50");
    expect(rec.targetAmount).toBe("12.50");
    expect(rec.flags).toBe("target_rules_may_modify");
  });

  it("builds valid JSON", () => {
    const parsed = JSON.parse(buildRunAuditJson([row()]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sourceItemKey).toBe("txn:t1");
  });

  it("escapes CSV fields containing commas", () => {
    const csv = buildRunAuditCsv([row()]);
    const [header, line] = csv.split("\r\n");
    expect(header.startsWith("sourceItemKey,classification")).toBe(true);
    // "Coffee, Bar" has a comma → must be quoted.
    expect(line).toContain('"Coffee, Bar"');
  });

  it("produces a filesystem-safe filename", () => {
    expect(auditFileName("run/../etc", "csv")).toBe("sync-audit-runetc.csv");
    expect(auditFileName("", "json")).toBe("sync-audit-run.json");
  });
});
