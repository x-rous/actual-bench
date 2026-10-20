import { formatStatementPeriod } from "./displayDates";
it("omits repeated years while retaining cross-year context", () => {
  expect(formatStatementPeriod("2026-09-01", "2026-09-30")).toBe("01 Sep – 30 Sep");
  expect(formatStatementPeriod("2025-12-08", "2026-01-07")).toBe("08 Dec 2025 – 07 Jan");
});
