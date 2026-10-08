/** Structural reads by stable identity or several bounded ranges, without directory lookups. */
export type SyncTransactionQuery = {
  ids?: readonly string[];
  importedIds?: readonly string[];
  resolveNames?: boolean;
  ranges?: ReadonlyArray<{ accountId: string; from: string; to: string }>;
};
export function syncTransactionFilter(input: SyncTransactionQuery): object {
  if (input.importedIds?.length) return { imported_id: { $oneof: [...new Set(input.importedIds)] } };
  if (input.ids?.length) return { id: { $oneof: [...new Set(input.ids)] } };
  if (input.ranges?.length) return { $or: input.ranges.map((range) => ({ $and: [
    { account: range.accountId }, { date: { $gte: range.from } }, { date: { $lte: range.to } },
  ] })) };
  throw new Error("A structural transaction query needs ids or date ranges.");
}
