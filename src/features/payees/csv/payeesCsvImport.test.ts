import { importPayeesFromCsv } from "./payeesCsvImport";

describe("importPayeesFromCsv", () => {
  it("imports payees from valid CSV", () => {
    const csv = "name\nAmazon\nNetflix";
    const result = importPayeesFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.payees).toHaveLength(2);
    expect(result.payees[0]).toEqual({ name: "Amazon" });
    expect(result.payees[1]).toEqual({ name: "Netflix" });
    expect(result.skipped).toBe(0);
  });

  it("skips rows with empty names", () => {
    // A row with an empty name column, rather than a blank line: a blank line is
    // whitespace and is not a row anybody wrote.
    const csv = "id,name\n1,Amazon\n2,\n3,Netflix";
    const result = importPayeesFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.payees).toHaveLength(2);
    expect(result.skipped).toBe(1);
  });

  it("ignores a blank line before the header instead of importing the header", () => {
    const csv = "\nname\nAmazon";
    const result = importPayeesFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.payees).toEqual([{ name: "Amazon" }]);
    expect(result.skipped).toBe(0);
  });

  it("does not count a trailing newline as a skipped row", () => {
    const result = importPayeesFromCsv("name\nAmazon\n");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.payees).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });

  it("returns an error when CSV has no data rows", () => {
    const result = importPayeesFromCsv("name");
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toMatch(/no data rows/i);
  });

  it('returns an error when the "name" column is missing', () => {
    const csv = "id,type\n1,regular";
    const result = importPayeesFromCsv(csv);
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toMatch(/name/i);
  });

  it("trims whitespace from names", () => {
    const csv = "name\n  Amazon  ";
    const result = importPayeesFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.payees[0].name).toBe("Amazon");
  });

  it("ignores extra columns beyond 'name'", () => {
    const csv = "id,name,type\n1,Amazon,regular\n2,Netflix,regular";
    const result = importPayeesFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.payees).toHaveLength(2);
    expect(result.payees[0]).toEqual({ name: "Amazon" });
  });

  it("skips transfer payees and counts them as skipped", () => {
    const csv = "id,name,type\n1,Amazon,regular\n2,Transfer: Savings,transfer\n3,Netflix,regular";
    const result = importPayeesFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.payees).toHaveLength(2);
    expect(result.payees.map((p) => p.name)).toEqual(["Amazon", "Netflix"]);
    expect(result.skipped).toBe(1);
  });

  it("skips transfer payees case-insensitively", () => {
    const csv = "name,type\nAmazon,TRANSFER";
    const result = importPayeesFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.payees).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });
});
