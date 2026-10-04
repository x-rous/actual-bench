import { buildVarianceCsvRows } from "./varianceCsv";
import { buildVarianceModel } from "./varianceViewModel";
import { statesFor } from "./testing";

describe("buildVarianceCsvRows", () => {
  const build = (mode: "tracking" | "envelope") =>
    buildVarianceModel({
      mode,
      side: "expense",
      months: ["2026-08"],
      statesByMonth: statesFor({
        "2026-08": [
          { id: "a", group: "g1", budgeted: mode === "tracking" ? -300000 : 300000, actuals: -450050, balance: -50 },
          { id: "b", group: "g2", budgeted: mode === "tracking" ? -100000 : 100000, actuals: -40000, balance: 60000 },
        ],
      }),
    });

  it("writes magnitudes with a direction word", () => {
    const rows = buildVarianceCsvRows(build("tracking"));
    expect(rows[0]).toEqual(["Group", "Group", "Budgeted", "Spent", "Variance", "Direction", "% of budget", "Share of gross side"]);
    expect(rows[1].slice(2, 6)).toEqual(["3000.00", "4500.50", "1500.50", "Overspent"]);
    expect(rows[2].slice(4, 6)).toEqual(["600.00", "Saved"]);
  });

  it("adds balance columns in Envelope", () => {
    const rows = buildVarianceCsvRows(build("envelope"));
    expect(rows[0].slice(-2)).toEqual(["Closing balance", "Deficit"]);
    expect(rows[1].slice(2, 4)).toEqual(["3000.00", "4500.50"]);
    expect(rows[1].slice(-2)).toEqual(["-0.50", "0.50"]);
  });
});
