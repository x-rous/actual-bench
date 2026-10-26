"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildAccountOptions, buildCategoryOptions, buildPayeeOptions } from "@/components/ui/entity-options";
import { getTransport } from "@/lib/actual";
import type { Tag } from "@/types/entities";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";

/** Accounts, categories, payees and tags of the active budget as combobox options, plus id → name lookups. */
export function useTransactionReference(opts: { excludeAccountIds?: string[]; excludeTransferPayees?: boolean } = {}) {
  const connection = useConnectionStore(selectActiveInstance);
  const reference = useQuery({
    queryKey: ["transactionPickerReference", connection?.id], enabled: !!connection,
    queryFn: async () => { const t = getTransport(connection!); const [accounts, groups, payees, tags] = await Promise.all([t.getAccounts(), t.getCategoryGroups(), t.getPayees(), t.getTags().catch(() => [] as Tag[])]); return { accounts, groups, payees, tags }; },
  });
  const { excludeAccountIds, excludeTransferPayees } = opts;
  const accounts = useMemo(() => (reference.data?.accounts ?? []).filter((a) => !(excludeAccountIds ?? []).includes(a.id)), [reference.data, excludeAccountIds]);
  const accountOptions = useMemo(() => buildAccountOptions(accounts, [], { closed: "dim" }), [accounts]);
  const categoryOptions = useMemo(() => buildCategoryOptions(reference.data?.groups.categories ?? [], reference.data?.groups.groups, { hidden: "dim" }), [reference.data]);
  const payeeOptions = useMemo(() => buildPayeeOptions(reference.data?.payees ?? [], { transfers: excludeTransferPayees ? "exclude" : "show" }), [reference.data, excludeTransferPayees]);
  const names = useMemo(() => {
    const category = new Map((reference.data?.groups.categories ?? []).map((c) => [c.id, c.name]));
    const payee = new Map((reference.data?.payees ?? []).map((p) => [p.id, p.name]));
    const account = new Map((reference.data?.accounts ?? []).map((a) => [a.id, a.name]));
    return { category: (id: string) => category.get(id) ?? "unknown category", payee: (id: string) => payee.get(id) ?? "unknown payee", account: (id: string) => account.get(id) ?? "unknown account" };
  }, [reference.data]);
  /** Actual's defined tags: `value` is the `#name` as it appears in Notes (lower case). */
  const tags = useMemo(() => (reference.data?.tags ?? []).map((t) => ({ id: `#${t.name.replace(/^#/, "")}`.toLocaleLowerCase(), name: `#${t.name.replace(/^#/, "")}`, color: t.color })), [reference.data]);
  return { ready: !!reference.data, accountOptions, categoryOptions, payeeOptions, tags, names };
}
