import { readCronFields } from "./cronFields";

describe("reading a cron expression field by field", () => {
  it("says what each field means", () => {
    expect(readCronFields("*/15 8-18 * * 1-5").map((field) => field.reading)).toEqual([
      "every 15 minutes",
      "08h–18h",
      "every day of the month",
      "every month",
      "Mon–Fri",
    ]);
  });

  it("points at the field that is wrong", () => {
    const fields = readCronFields("0 25 * * *");
    expect(fields[1]).toMatchObject({ valid: false, reading: expect.stringMatching(/outside 0-23/) });
    expect(fields.filter((field) => !field.valid)).toHaveLength(1);
  });

  it("names a missing field and an extra one", () => {
    expect(readCronFields("0 2 *")[3]).toMatchObject({ valid: false, reading: "missing" });
    expect(readCronFields("0 2 * * * 2026")).toHaveLength(6);
  });
});
