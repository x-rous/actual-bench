import type { ColumnInfo } from "../types";
import {
  buildCsvRows,
  encodeCsvCell,
  estimateCsvBytes,
  csvExportFilename,
} from "./csvExport";

function column(name: string, type: string): ColumnInfo {
  return {
    cid: 0,
    name,
    type,
    notNull: false,
    defaultValue: null,
    primaryKeyPosition: 0,
  };
}

describe("csvExport", () => {
  it("neutralizes formula-like string values without changing numeric values", () => {
    expect(encodeCsvCell("=cmd|' /C calc'!A0", column("memo", "TEXT"))).toBe(
      "'=cmd|' /C calc'!A0"
    );
    expect(encodeCsvCell("-12345", column("memo", "TEXT"))).toBe("'-12345");
    expect(encodeCsvCell("@formula", column("value", "INTEGER"))).toBe("'@formula");
    expect(encodeCsvCell(-12345, column("amount", "INTEGER"))).toBe("-12345");
    expect(encodeCsvCell(-12.5, column("rate", "REAL"))).toBe("-12.5");
  });

  it("exports nulls as empty fields", () => {
    expect(encodeCsvCell(null, column("notes", "TEXT"))).toBe("");
    expect(buildCsvRows([{ notes: null }], [column("notes", "TEXT")])).toBe("");
  });

  it("exports binary values as capped base64 payloads", () => {
    expect(encodeCsvCell(new Uint8Array([65, 66, 67]), column("value", "BLOB"))).toBe(
      "base64:QUJD"
    );

    const large = new Uint8Array(4096).fill(65);
    const encoded = encodeCsvCell(large, column("value", "BLOB"));
    expect(encoded.startsWith("base64:")).toBe(true);
    expect(encoded.endsWith(";truncated=true")).toBe(true);
    expect(encoded.length).toBeLessThanOrEqual("base64:".length + 4096 + ";truncated=true".length);
  });

  it("estimates export size from sampled encoded cells", () => {
    expect(
      estimateCsvBytes(
        10,
        [
          { id: "a", amount: -1 },
          { id: "bb", amount: -22 },
        ],
        [column("id", "TEXT"), column("amount", "INTEGER")]
      )
    ).toBeGreaterThan(0);
  });

  it("builds safe dated filenames", () => {
    expect(csvExportFilename("v transactions", new Date("2026-04-22T00:00:00.000Z"))).toBe(
      "budget-diagnostics-v_transactions-2026-04-22.csv"
    );
  });
});
