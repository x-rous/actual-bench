import type { SchemaObjectGroup, SchemaObjectSummary } from "../types";

export type SchemaObjectGroupDefinition = {
  id: SchemaObjectGroup;
  label: string;
};

export const SCHEMA_OBJECT_GROUPS: readonly SchemaObjectGroupDefinition[] = [
  { id: "featuredViews", label: "Featured views" },
  { id: "coreTables", label: "Core tables" },
  { id: "mappingTables", label: "Mapping tables" },
  { id: "budgetTables", label: "Budget tables" },
  { id: "systemMetadata", label: "System / metadata" },
  { id: "reportingDashboard", label: "Reporting / dashboard" },
  { id: "other", label: "Other" },
];

export function groupSchemaObjects(objects: readonly SchemaObjectSummary[]) {
  const byGroup = new Map<SchemaObjectGroup, SchemaObjectSummary[]>();

  for (const group of SCHEMA_OBJECT_GROUPS) {
    byGroup.set(group.id, []);
  }

  for (const object of objects) {
    byGroup.get(object.group)?.push(object);
  }

  return SCHEMA_OBJECT_GROUPS.map((group) => ({
    ...group,
    objects: byGroup.get(group.id) ?? [],
  })).filter((group) => group.objects.length > 0);
}

export function defaultSchemaObjectSelection(
  objects: readonly SchemaObjectSummary[]
): SchemaObjectSummary | null {
  return (
    objects.find((object) => object.name === "v_transactions") ??
    objects.find((object) => object.featured && object.type === "view") ??
    objects.find(
      (object) =>
        (object.type === "table" || object.type === "view") &&
        object.rowCount !== null &&
        object.rowCount > 0
    ) ??
    objects.find((object) => object.type === "table" || object.type === "view") ??
    objects[0] ??
    null
  );
}
