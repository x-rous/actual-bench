import { DEFAULT_MATCH_CONFIG } from "@/lib/reconciliation/match/config";
import { resumeWindowInput } from "./loadCandidates";

function session(overrides: Partial<Parameters<typeof resumeWindowInput>[0]> = {}) {
  return {
    accountId: "acct-1",
    statementStart: "2026-08-01",
    statementEnd: "2026-08-31",
    matchConfig: DEFAULT_MATCH_CONFIG,
    ...overrides,
  };
}

/*
 * A resumed session rebuilds its Actual side by reading the window again rather
 * than from the snapshots it stored, because those are drift baselines - one per
 * decided item - and a review item's other candidates were never among them
 * (F-151c). The property worth defending is that the *same* window comes back:
 * a resumed session that quietly reads a narrower one would drop candidates just
 * as the old code did, only less visibly.
 */
describe("the window a resumed session re-reads", () => {
  it("reproduces the period and tolerances the session matched with", () => {
    expect(resumeWindowInput(session())).toEqual({
      accountId: "acct-1",
      statementStart: "2026-08-01",
      statementEnd: "2026-08-31",
      matchToleranceDays: DEFAULT_MATCH_CONFIG.dateToleranceDays,
      paddingDays: DEFAULT_MATCH_CONFIG.candidatePaddingDays,
    });
  });

  it("honours a session's own tolerances over the current defaults", () => {
    // A session matched with a widened window must re-read that window, not
    // today's default - otherwise resuming silently loses the candidates the
    // wider setting was chosen to reach.
    const input = resumeWindowInput(
      session({ matchConfig: { ...DEFAULT_MATCH_CONFIG, dateToleranceDays: 21, candidatePaddingDays: 14 } })
    );

    expect(input).toMatchObject({ matchToleranceDays: 21, paddingDays: 14 });
  });

  it.each([
    ["no match config at all", null],
    ["a config that predates these fields", { autoMatchFloor: 60 }],
    ["something that is not a config", "nonsense"],
  ])("falls back to the defaults given %s", (_label, matchConfig) => {
    expect(resumeWindowInput(session({ matchConfig }))).toMatchObject({
      matchToleranceDays: DEFAULT_MATCH_CONFIG.dateToleranceDays,
      paddingDays: DEFAULT_MATCH_CONFIG.candidatePaddingDays,
    });
  });

  it.each([
    ["no start", { statementStart: null }],
    ["no end", { statementEnd: null }],
  ])("has nothing to read for a session with %s", (_label, overrides) => {
    // A session that has not imported a statement yet. Returning an input here
    // would send a request for an unbounded range.
    expect(resumeWindowInput(session(overrides))).toBeNull();
  });
});
