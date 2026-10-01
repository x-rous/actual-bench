import type { DebtProjection, DebtProjectionInput } from "@/lib/financial-models/loan/projection";
import { createSyncRunner, createWorkerRunner } from "./projectionRunner";
import { projectionWindow, simulationToModel, withoutExtraTransactions, type SimulationState } from "./simulatorModel";
import { sim } from "./simulatorTestKit";

function inputFor(state: SimulationState): DebtProjectionInput {
  const built = simulationToModel(state);
  if (!built.ok) throw new Error(built.missing.join(", "));
  const window = projectionWindow(state);
  return {
    model: built.model,
    anchor: { date: built.model.terms.openingDate, principalMinor: built.model.terms.openingPrincipalMinor, accruedInterestMinor: 0, source: "opening" },
    events: [],
    from: window.from,
    to: window.to,
  };
}

describe("projection runner impact baseline", () => {
  it("projects the current loan and its identical no-extra baseline in one run", async () => {
    const current = sim({
      termMonths: 36,
      assumptions: [{ key: "extra", kind: "extra-repayment", effectiveFrom: "2024-06-01", recurrence: null, amountMinor: 50_000, feeTreatment: null, offsetAccountId: null, note: null }],
    });
    const outcome = await createSyncRunner().run(inputFor(current), null, inputFor(withoutExtraTransactions(current)));
    expect(outcome.projection.ok).toBe(true);
    expect(outcome.impactBaseline?.ok).toBe(true);
    if (!outcome.projection.ok || !outcome.impactBaseline?.ok) return;
    expect(outcome.projection.events.reduce((sum, event) => sum + event.interestMinor, 0)).toBeLessThan(outcome.impactBaseline.events.reduce((sum, event) => sum + event.interestMinor, 0));
  });

  it("passes the impact input through the worker contract and returns its result", async () => {
    const posted: unknown[] = [];
    let fake: {
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
      postMessage: (message: unknown) => void;
      terminate: () => void;
    };
    const runner = createWorkerRunner(() => {
      fake = {
        onmessage: null,
        onerror: null,
        postMessage: (message) => posted.push(message),
        terminate: jest.fn(),
      };
      return fake as unknown as Worker;
    });
    const primary = {} as DebtProjectionInput;
    const impact = {} as DebtProjectionInput;
    const projection = { ok: true, events: [], monthly: [] } as unknown as DebtProjection;
    const promise = runner.run(primary, null, impact);
    expect(posted).toEqual([{ id: 1, primary, comparison: null, impactBaseline: impact }]);
    fake!.onmessage!({ data: { id: 1, ok: true, projection, comparison: null, impactBaseline: projection, durationMs: 2 } } as MessageEvent);
    await expect(promise).resolves.toMatchObject({ projection, impactBaseline: projection, durationMs: 2 });
  });
});
