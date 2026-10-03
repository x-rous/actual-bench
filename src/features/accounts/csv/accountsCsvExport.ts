import { csvCell, csvField } from "@/lib/csv";
import type { StagedMap } from "@/types/staged";
import type { Account, AccountGroup } from "@/types/entities";

/**
 * Serializes staged accounts to a CSV string (no BOM, no blob — caller handles download).
 * Deleted entities are excluded.
 *
 * Pass `groups` (the live account groups) to add a `group` column holding the
 * group's name; omit it for servers without account groups and the file keeps
 * the original four columns. Group names are typed by people, so they go through
 * `csvCell`, which keeps a leading `=`, `+`, `-` or `@` from running as a formula.
 */
export function exportAccountsToCsv(
  staged: StagedMap<Account>,
  groups?: readonly AccountGroup[]
): string {
  const rows = Object.values(staged).filter((s) => !s.isDeleted);
  const groupName = (id: string | null | undefined) => (id ? groups?.find((g) => g.id === id)?.name ?? "" : "");
  const lines = [
    groups ? "id,name,offBudget,closed,group" : "id,name,offBudget,closed",
    ...rows.map(({ entity: { id, name, offBudget, closed, groupId } }) =>
      `${id},${csvField(name)},${offBudget},${closed}${groups ? `,${csvCell(groupName(groupId))}` : ""}`
    ),
  ];
  return lines.join("\n");
}
