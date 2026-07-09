import { isFlowDue, selectFlowsToAutoRun, type SchedulableFlow } from "./scheduler";

const NOW = 1_000_000_000_000;

function flow(overrides: Partial<SchedulableFlow> = {}): SchedulableFlow {
  return {
    flowId: "f1",
    reviewPolicy: "auto_sync_on_interval",
    enabled: true,
    intervalMinutes: 60,
    connectionsReady: true,
    lastRunAtMs: null,
    ...overrides,
  };
}

const noneInFlight = new Set<string>();

describe("isFlowDue", () => {
  it("runs an opted-in flow that has never run", () => {
    expect(isFlowDue(flow(), noneInFlight, NOW)).toBe(true);
  });

  it("never runs manual or auto-apply-on-preview policies on the interval", () => {
    expect(isFlowDue(flow({ reviewPolicy: "manual_preview_required" }), noneInFlight, NOW)).toBe(false);
    expect(isFlowDue(flow({ reviewPolicy: "auto_apply_safe_only" }), noneInFlight, NOW)).toBe(false);
  });

  it("never runs a disabled/paused flow", () => {
    expect(isFlowDue(flow({ enabled: false }), noneInFlight, NOW)).toBe(false);
  });

  it("skips a flow whose connections are locked/absent", () => {
    expect(isFlowDue(flow({ connectionsReady: false }), noneInFlight, NOW)).toBe(false);
  });

  it("never double-runs an in-flight flow", () => {
    expect(isFlowDue(flow({ flowId: "busy" }), new Set(["busy"]), NOW)).toBe(false);
  });

  it("honors the interval: not due before it elapses, due after", () => {
    const justRan = flow({ lastRunAtMs: NOW - 59 * 60_000 }); // 59 min ago, interval 60
    const overdue = flow({ lastRunAtMs: NOW - 61 * 60_000 }); // 61 min ago
    expect(isFlowDue(justRan, noneInFlight, NOW)).toBe(false);
    expect(isFlowDue(overdue, noneInFlight, NOW)).toBe(true);
  });
});

describe("selectFlowsToAutoRun", () => {
  it("returns only the due, opted-in, ready, not-in-flight flows", () => {
    const flows: SchedulableFlow[] = [
      flow({ flowId: "due-never" }),
      flow({ flowId: "due-overdue", lastRunAtMs: NOW - 120 * 60_000 }),
      flow({ flowId: "manual", reviewPolicy: "manual_preview_required" }),
      flow({ flowId: "disabled", enabled: false }),
      flow({ flowId: "locked", connectionsReady: false }),
      flow({ flowId: "busy" }),
      flow({ flowId: "recent", lastRunAtMs: NOW - 5 * 60_000 }),
    ];
    const due = selectFlowsToAutoRun({ flows, inFlight: new Set(["busy"]), nowMs: NOW });
    expect(due.sort()).toEqual(["due-never", "due-overdue"]);
  });

  it("returns nothing when no flow has opted into interval auto-sync", () => {
    const flows = [
      flow({ flowId: "a", reviewPolicy: "manual_preview_required" }),
      flow({ flowId: "b", reviewPolicy: "auto_apply_safe_only" }),
    ];
    expect(selectFlowsToAutoRun({ flows, inFlight: noneInFlight, nowMs: NOW })).toEqual([]);
  });
});
