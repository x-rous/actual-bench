export function getGroupCollapseState(
  collapsedGroups: Set<string>,
  groupIds: string[]
) {
  return {
    canCollapseGroups: groupIds.some((groupId) => !collapsedGroups.has(groupId)),
    canExpandGroups: groupIds.some((groupId) => collapsedGroups.has(groupId)),
    allCollapsed:
      groupIds.length > 0 && groupIds.every((groupId) => collapsedGroups.has(groupId)),
  };
}

export function collapseGroupIds(
  collapsedGroups: Set<string>,
  groupIds: Iterable<string>
) {
  const next = new Set(collapsedGroups);
  for (const groupId of groupIds) {
    next.add(groupId);
  }
  return next;
}

export function expandGroupIds(
  collapsedGroups: Set<string>,
  groupIds: Iterable<string>
) {
  const next = new Set(collapsedGroups);
  for (const groupId of groupIds) {
    next.delete(groupId);
  }
  return next;
}
