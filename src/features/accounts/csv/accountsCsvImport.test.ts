import { importAccountsFromCsv } from "./accountsCsvImport";

describe("importAccountsFromCsv", () => {
  it("imports accounts from valid CSV", () => {
    const csv = "name,offBudget,closed\nChecking,false,false\nSavings,true,false";
    const result = importAccountsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0]).toMatchObject({ name: "Checking", offBudget: false, closed: false });
    expect(result.accounts[1]).toMatchObject({ name: "Savings", offBudget: true, closed: false });
    expect(result.skipped).toBe(0);
  });

  it("is case-insensitive for column headers", () => {
    const csv = "NAME,OFFBUDGET,CLOSED\nChecking,false,false";
    const result = importAccountsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.accounts).toHaveLength(1);
  });

  it("defaults offBudget and closed to false when columns are absent", () => {
    const csv = "name\nChecking";
    const result = importAccountsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.accounts[0]).toMatchObject({ offBudget: false, closed: false });
  });

  it("skips rows with empty names and increments skipped count", () => {
    // A row that exists but has no name, rather than a blank line: a blank line
    // is whitespace and is not a row anybody wrote.
    const csv = "name,offBudget\nChecking,false\n,true\nSavings,false";
    const result = importAccountsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.accounts).toHaveLength(2);
    expect(result.skipped).toBe(1);
  });

  it("ignores a blank line before the header instead of importing the header", () => {
    // The header was read from the blank-filtered lines while the rows were read
    // from the unfiltered ones, so every row landed one line early and the
    // header itself was staged as an account called "name".
    const csv = "\nname,offBudget,closed\nChecking,true,false";
    const result = importAccountsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.accounts).toEqual([{ name: "Checking", offBudget: true, closed: false }]);
    expect(result.skipped).toBe(0);
  });

  it("does not count a trailing newline as a skipped row", () => {
    // Most editors add one, so this reported "1 row skipped" on almost every file.
    const result = importAccountsFromCsv("name\nChecking\n");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.accounts).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });

  it("returns an error when CSV has no data rows", () => {
    const result = importAccountsFromCsv("name");
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toMatch(/no data rows/i);
  });

  it('returns an error when the "name" column is missing', () => {
    const csv = "id,offBudget\n1,false";
    const result = importAccountsFromCsv(csv);
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toMatch(/name/i);
  });

  it("parses boolean values case-insensitively", () => {
    const csv = "name,offBudget,closed\nChecking,TRUE,YES";
    const result = importAccountsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.accounts[0]).toMatchObject({ offBudget: true, closed: true });
  });

  it("handles CRLF line endings", () => {
    const csv = "name\r\nChecking\r\nSavings";
    const result = importAccountsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.accounts).toHaveLength(2);
  });

  it("handles quoted names with commas", () => {
    const csv = 'name\n"Smith, John"\nChecking';
    const result = importAccountsFromCsv(csv);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.accounts[0].name).toBe("Smith, John");
  });
});
