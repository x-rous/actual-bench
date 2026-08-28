import { describeRiskyChange, shouldTakeRecoveryPoint } from "./safetyPoint";

describe("which changes are worth a recovery point", () => {
  it("does not export a whole budget to rename one payee", () => {
    expect(shouldTakeRecoveryPoint({ itemCount: 1 })).toBe(false);
    expect(shouldTakeRecoveryPoint({ itemCount: 10 })).toBe(false);
  });

  it("always takes one before a payee merge, however small", () => {
    // Merges are irreversible in Actual: undo does not bring the payee back.
    expect(shouldTakeRecoveryPoint({ itemCount: 2, mergeCount: 1 })).toBe(true);
  });

  it("always takes one before a deletion", () => {
    expect(shouldTakeRecoveryPoint({ itemCount: 1, deleteCount: 1 })).toBe(true);
  });

  it("takes one for a large batch on size alone", () => {
    expect(shouldTakeRecoveryPoint({ itemCount: 24 })).toBe(false);
    expect(shouldTakeRecoveryPoint({ itemCount: 25 })).toBe(true);
  });

  it("describes the change in the words the user would use", () => {
    expect(describeRiskyChange({ itemCount: 40, mergeCount: 3 })).toBe("saving 3 payee merges");
    expect(describeRiskyChange({ itemCount: 5, deleteCount: 1 })).toBe("saving 1 deletion");
    expect(describeRiskyChange({ itemCount: 30 })).toBe("saving 30 changes");
  });
});
