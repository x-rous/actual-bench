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
    const csv = "name\nAmazon\n\nNetflix";
    const result = importPayeesFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.payees).toHaveLength(2);
    expect(result.skipped).toBe(1);
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
