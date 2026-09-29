import { compareRows, loadFamily } from "./__fixtures__/harness";
import { runDailyLoanFixture } from "./__fixtures__/checks";

describe("bench-daily against the au-daily fixtures (Figura calculator order)", () => {
  it.each(loadFamily("au-daily").map((f) => [f.name, f] as const))("%s matches every row", (_n, fixture) => {
    const rows = runDailyLoanFixture(fixture);
    expect(typeof rows === "string" ? rows : compareRows(fixture.expected, rows)).toEqual([]);
  });
});
