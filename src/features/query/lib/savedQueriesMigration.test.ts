import {
  collectLegacySavedQueries,
  hasMigratedLegacySavedQueries,
  migrateLegacySavedQueriesOnce,
} from "./savedQueriesMigration";

describe("saved queries legacy migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("collects and dedupes saved queries across per-budget keys", () => {
    localStorage.setItem(
      "actualql-saved-queries:budget-a",
      JSON.stringify([
        { id: "1", name: "Txns", query: '{"table":"transactions"}', isFavorite: true },
        { id: "2", name: "  ", query: "{}" }, // blank name → skipped
      ]),
    );
    localStorage.setItem(
      "actualql-saved-queries:budget-b",
      JSON.stringify([
        { id: "3", name: "Txns", query: '{"table":"transactions"}' }, // dup across budgets
        { id: "4", name: "Payees", query: '{"table":"payees"}' },
      ]),
    );
    localStorage.setItem("unrelated-key", JSON.stringify([{ name: "nope", query: "{}" }]));

    const collected = collectLegacySavedQueries();
    expect(collected.map((q) => q.name).sort()).toEqual(["Payees", "Txns"]);
    expect(collected.find((q) => q.name === "Txns")?.isFavorite).toBe(true);
  });

  it("runs the import once and sets the migrated flag on success", async () => {
    localStorage.setItem(
      "actualql-saved-queries:budget-a",
      JSON.stringify([{ id: "1", name: "A", query: "{}" }]),
    );
    const importFn = jest.fn().mockResolvedValue({ imported: 1 });

    const first = await migrateLegacySavedQueriesOnce(importFn);
    expect(first).toBe(1);
    expect(importFn).toHaveBeenCalledTimes(1);
    expect(hasMigratedLegacySavedQueries()).toBe(true);

    // Second call is a no-op — already migrated.
    const second = await migrateLegacySavedQueriesOnce(importFn);
    expect(second).toBe(0);
    expect(importFn).toHaveBeenCalledTimes(1);
  });

  it("marks migrated without calling import when there is nothing to migrate", async () => {
    const importFn = jest.fn().mockResolvedValue({ imported: 0 });
    const result = await migrateLegacySavedQueriesOnce(importFn);
    expect(result).toBe(0);
    expect(importFn).not.toHaveBeenCalled();
    expect(hasMigratedLegacySavedQueries()).toBe(true);
  });

  it("does not set the flag if the import throws, so it retries next load", async () => {
    localStorage.setItem(
      "actualql-saved-queries:budget-a",
      JSON.stringify([{ id: "1", name: "A", query: "{}" }]),
    );
    const importFn = jest.fn().mockRejectedValue(new Error("network"));

    await expect(migrateLegacySavedQueriesOnce(importFn)).rejects.toThrow("network");
    expect(hasMigratedLegacySavedQueries()).toBe(false);
  });
});
