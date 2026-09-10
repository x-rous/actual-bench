import { importTagsFromCsv } from "./tagsCsvImport";

describe("importTagsFromCsv", () => {
  it("imports tags with their colour and description", () => {
    const csv = "name,color,description\nholiday,#4f46e5,Summer trip\nwork,,";
    const result = importTagsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.tags).toEqual([
      { name: "holiday", color: "#4f46e5", description: "Summer trip" },
      { name: "work", color: undefined, description: undefined },
    ]);
    expect(result.skipped).toBe(0);
  });

  it("ignores a blank line before the header instead of importing the header", () => {
    // The header was read from the blank-filtered lines while the rows were read
    // from the unfiltered ones, so every row landed one line early and the header
    // itself was staged as a tag called "name". The blank-line guard inside the
    // loop hid the symptom for blank rows but never fixed the offset.
    const csv = "\nname,color\nholiday,#4f46e5";
    const result = importTagsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.tags).toEqual([
      { name: "holiday", color: "#4f46e5", description: undefined },
    ]);
    expect(result.skipped).toBe(0);
  });

  it("skips a row with no name", () => {
    const csv = "name,color\nholiday,#4f46e5\n,#000000";
    const result = importTagsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.tags).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("drops a colour that is not a hex value, keeping the tag", () => {
    const csv = "name,color\nholiday,not-a-colour";
    const result = importTagsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.tags[0]).toMatchObject({ name: "holiday", color: undefined });
  });

  it("returns an error when there are no data rows", () => {
    expect(importTagsFromCsv("name,color")).toEqual({ error: "CSV has no data rows." });
  });

  it("returns an error when the name column is missing", () => {
    const result = importTagsFromCsv("colour,description\n#fff,x");
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toMatch(/name/i);
  });
});
