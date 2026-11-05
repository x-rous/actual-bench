import { compactMoney } from "./format";

describe("short axis labels", () => {
  it("shorten thousands and millions", () => {
    expect([123_456_00, 1_234_00, 12_345_00, 2_500_000_00, -3_400_00].map(compactMoney)).toEqual(["123k", "1.2k", "12k", "2.5m", "-3.4k"]);
  });

  it("keep the decimals a few-cent axis needs, and plain whole units otherwise", () => {
    expect([0, 20, 40, 60, 80].map(compactMoney)).toEqual(["0", "0.2", "0.4", "0.6", "0.8"]);
    expect([500, 20_000, -250].map(compactMoney)).toEqual(["5", "200", "-2.5"]);
  });
});
