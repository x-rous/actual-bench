import { EXPECTED_COLUMNS, EXPECTED_TABLES, EXPECTED_VIEWS } from "./expectedSchema";
import { RELATIONSHIPS } from "./relationshipMap";

describe("relationshipMap", () => {
  it("uses unique relationship codes", () => {
    const codes = RELATIONSHIPS.map((relationship) => relationship.code);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it("only references known schema objects and columns", () => {
    const tableNames = new Set<string>(EXPECTED_TABLES);
    const objectNames = new Set<string>([...EXPECTED_TABLES, ...EXPECTED_VIEWS]);

    for (const relationship of RELATIONSHIPS) {
      expect(objectNames.has(relationship.from.object)).toBe(true);
      expect(tableNames.has(relationship.to.table)).toBe(true);
      expect(EXPECTED_COLUMNS[relationship.from.object]).toContain(relationship.from.column);
      expect(EXPECTED_COLUMNS[relationship.to.table]).toContain(relationship.to.column);
    }
  });
});
