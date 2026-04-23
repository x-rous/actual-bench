import { buildOverviewMetrics, formatBytes, formatCount } from "./fileOverviewStats";
import type { OverviewPayload } from "../types";

const overview: OverviewPayload = {
  metadata: null,
  file: {
    dbSizeBytes: 1536,
    zipFilename: "budget.zip",
    zipSizeBytes: 4096,
    hadMetadata: true,
    opened: true,
    zipValid: true,
  },
  counts: {
    tables: 31,
    views: 6,
    transactions: 1200,
    accounts: 4,
    payees: 50,
    category_groups: 8,
    categories: 43,
    rules: 12,
    schedules: 3,
    tags: 5,
    notes: 9,
  },
};

describe("fileOverviewStats", () => {
  it("formats counts with grouping", () => {
    expect(formatCount(1200)).toBe("1,200");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12)).toBe("12 B");
  });

  it("builds the expected overview metrics", () => {
    const metrics = buildOverviewMetrics(overview);

    expect(metrics).toHaveLength(12);
    expect(metrics.map((metric) => metric.id)).toEqual([
      "tables",
      "views",
      "transactions",
      "accounts",
      "payees",
      "category_groups",
      "categories",
      "rules",
      "schedules",
      "tags",
      "notes",
      "db_size",
    ]);
  });
});
