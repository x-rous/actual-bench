import { csv } from "./fixtureFiles";

describe("oracle fixture CSV reader", () => {
  const rows = [{ start: "2024-01-01", end: "2024-02-01", interest_minor: "100" }];

  it("reads LF files", () => {
    expect(csv("start,end,interest_minor\n2024-01-01,2024-02-01,100\n")).toEqual(rows);
  });

  it("reads CRLF files, with no carriage return left on the last column", () => {
    expect(csv("start,end,interest_minor\r\n2024-01-01,2024-02-01,100\r\n")).toEqual(rows);
  });
});
