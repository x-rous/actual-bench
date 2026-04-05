import { csvField } from "@/lib/csv";
import type { StagedMap } from "@/types/staged";
import type { Tag } from "@/types/entities";

/**
 * Serializes staged tags to a CSV string.
 * Deleted entries are excluded. Color column is empty when no color is assigned.
 */
export function exportTagsToCsv(staged: StagedMap<Tag>): string {
  const rows = Object.values(staged).filter((s) => !s.isDeleted);
  const lines = [
    "id,name,color,description",
    ...rows.map(({ entity: { id, name, color, description } }) =>
      `${id},${csvField(name)},${csvField(color)},${csvField(description)}`
    ),
  ];
  return lines.join("\n");
}
