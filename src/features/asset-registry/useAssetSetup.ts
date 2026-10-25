"use client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { buildAccountOptions } from "@/components/ui/entity-options";
import { useDiscardChanges } from "@/features/credit-cards/hooks/useDiscardChanges";
import { useAccounts } from "@/features/accounts/hooks/useAccounts";
import { useAccountGroups } from "@/features/accounts/hooks/useAccountGroups";
import { useAccountsSave } from "@/features/accounts/hooks/useAccountsSave";
import { useAccountClasses } from "@/features/accounts/hooks/useAccountClasses";
import type { AccountFormValues } from "@/features/accounts/schemas/account.schema";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import type { Account } from "@/types/entities";
import { ASSET_TYPES, defaultIncomeGenerating, eligibility, type Asset, type AssetInput, type AssetType, type Registry } from "@/lib/asset-registry/models";
import { bankToday } from "@/features/credit-cards/lib/cycles";
import { registryRequest } from "./api";

/**
 * The state and the save sequence behind creating or editing an asset: the draft, the account choice (an existing
 * off-budget account of the right class, or a new one staged and created with the asset), the shared-account hashtag
 * and validation. Used by the settings drawer and by the creation wizard, so both behave identically.
 */
export function useAssetSetup({ connection, asset, accounts, registry, onDiscard, ownershipFrom }: { connection: ConnectionInstance; asset?: Asset; accounts: Account[]; registry: Registry; onDiscard: () => void; /** Start of the first ownership period for a new asset (default: today). */ ownershipFrom?: string }) {
  const [draft, setDraft] = useState<AssetInput>(() => ({ id: asset?.id ?? generateId(), actualAccountId: asset?.actualAccountId ?? "", name: asset?.name ?? "", assetType: (asset?.assetType ?? "vehicle") as AssetType, description: asset?.description ?? "", status: asset?.status === "archived" ? "archived" : "active", incomeGenerating: asset?.incomeGenerating ?? defaultIncomeGenerating(asset?.assetType ?? "vehicle"), revision: asset?.revision ?? 0, ownership: asset?.ownership ?? [{ effectiveFrom: ownershipFrom ?? bankToday(Intl.DateTimeFormat().resolvedOptions().timeZone), ownershipBps: 10000 }] }));
  const [accountMode, setAccountMode] = useState<"dedicated" | "shared">(asset?.assetTag ? "shared" : "dedicated");
  const [hashtag, setHashtag] = useState(asset?.assetTag ?? "");
  const [initial] = useState(() => JSON.stringify(draft));
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<{ name?: string; account?: string; hashtag?: string }>({});
  const [incomeTouched, setIncomeTouched] = useState(!!asset);
  const [busy, setBusy] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [createUncertain, setCreateUncertain] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const classes = useAccountClasses();
  const accountsQuery = useAccounts();
  const groups = useAccountGroups();
  const saver = useAccountsSave();
  const queryClient = useQueryClient();
  const staged = useStagedStore((s) => s.accounts);
  const initialAccount = useMemo(() => ({ offBudget: true, accountClass: ASSET_TYPES[draft.assetType]?.accountClass, name: draft.name }), [draft.assetType, draft.name]);
  const linkedElsewhere = (id: string, mode = accountMode) => mode !== "shared" && registry.assets.some((other) => other.actualAccountId === id && other.id !== asset?.id);
  /** Why an account cannot be chosen now, or null. Ineligible accounts stay visible with this reason (spec §4). */
  const unavailableReason = (a: Account, mode = accountMode): string | null => eligibility(a, draft.assetType, classes.maps) ?? (staged[a.id]?.isNew ? "Unsaved account" : null) ?? (linkedElsewhere(a.id, mode) ? "Already linked: choose Shared to add another asset" : null);
  /** Only accounts this asset can actually use are offered (the saved one always stays), so the list is short and every choice works. */
  const offered = accounts.filter((a) => a.id === draft.actualAccountId || !unavailableReason(a));
  const accountOptions = buildAccountOptions(offered, [], { closed: "show" });
  const hiddenAccounts = accounts.length - offered.length;
  const shared = registry.assets.some((a) => a.actualAccountId === draft.actualAccountId && a.id !== draft.id);
  const discard = useDiscardChanges(initial !== JSON.stringify(draft) || !!pendingId || hashtag !== (asset?.assetTag ?? ""), () => {
    if (pendingId && useStagedStore.getState().accounts[pendingId]?.isNew) useStagedStore.getState().stageDelete("accounts", pendingId);
    onDiscard();
  });
  function close() { if (!busy) discard.requestClose(); }
  function stageAccount(values: AccountFormValues) {
    const store = useStagedStore.getState();
    const reason = eligibility({ id: "draft", name: values.name, offBudget: values.offBudget, closed: false, groupId: values.groupId }, draft.assetType, { accounts: new Map(values.accountClass ? [["draft", values.accountClass]] : []), groups: classes.maps.groups });
    if (reason) { setError(reason); return; }
    if (pendingId && store.accounts[pendingId]?.isNew) store.stageDelete("accounts", pendingId);
    store.pushUndo();
    const id = generateId();
    store.stageNew("accounts", { id, name: values.name, offBudget: values.offBudget, closed: false, initialBalance: values.initialBalance, ...(groups.supported ? { groupId: values.groupId ?? null } : {}) });
    if (values.accountClass) store.stageAccountClass(id, values.accountClass);
    setPendingId(id); setDraft((d) => ({ ...d, actualAccountId: "" })); setError("");
  }
  async function saveAccounts() {
    setError("");
    const summary = await saver.save({ accountIds: pendingId ? [pendingId] : [] });
    if (pendingId && !summary?.idMap?.[pendingId] && useStagedStore.getState().accounts[pendingId]?.isNew) {
      setCreateUncertain(true);
      await accountsQuery.refetch();
      throw new Error("Account creation was not confirmed. Inspect Actual and the Accounts table before retrying. Remove any duplicate unsaved draft, confirm the saved account class, then return to the preserved asset draft and select the saved account. This editor will not repeat the create.");
    }
    const realId = pendingId ? summary?.idMap?.[pendingId] ?? pendingId : null;
    if (realId) setPendingId(realId); // retry failed class/group under its permanent ID
    const fresh = await getTransport(connection).getAccounts();
    const records = await queryClient.fetchQuery({ queryKey: ["accountClasses", connection.budgetSyncId], staleTime: 0, queryFn: async () => {
      const r = await fetch(`/api/account-classes?budgetSyncId=${encodeURIComponent(connection.budgetSyncId)}`);
      if (!r.ok) throw new Error("Could not confirm saved account class");
      return (await r.json()).accountClasses as { scope: string; accountId: string; accountClass: typeof initialAccount.accountClass }[];
    } });
    const maps = { accounts: new Map(records.filter((r) => r.scope === "account").map((r) => [r.accountId, r.accountClass])), groups: new Map(records.filter((r) => r.scope === "group").map((r) => [r.accountId, r.accountClass])) };
    const saved = fresh.find((a) => a.id === realId);
    const pending = realId ? useStagedStore.getState().accounts[realId] : null;
    if (!saved || pending?.isNew || pending?.isUpdated || pending?.saveError || eligibility(saved, draft.assetType, maps)) throw new Error("Account or class/group save is incomplete. Review Accounts errors and Save again; the asset draft is preserved.");
    await accountsQuery.refetch();
    setDraft((d) => ({ ...d, actualAccountId: saved.id })); setPendingId(null); return saved.id;
  }
  /** Drops a new account that was staged but not created yet (the owner chose another account, or went back). */
  function discardPending() {
    if (pendingId && useStagedStore.getState().accounts[pendingId]?.isNew) useStagedStore.getState().stageDelete("accounts", pendingId);
    setPendingId(null);
  }
  /** `assumeAccount` skips the account check for a new account that will be staged right after. */
  function validate(assumeAccount = false) {
    const next: { name?: string; account?: string; hashtag?: string } = {};
    if (!draft.name.trim()) next.name = "Enter a name for this asset.";
    if (!assumeAccount && !pendingId && !draft.actualAccountId) next.account = "Choose a saved off-budget account, or create one.";
    if (accountMode === "shared" && !asset?.assetTag && !/^#asset_[a-z0-9_-]{1,93}$/.test(hashtag)) next.hashtag = "Use a unique hashtag such as #asset_family_car (lowercase letters, numbers, underscores or hyphens).";
    else if (accountMode === "shared" && registry.assets.some((other) => other.id !== draft.id && other.assetTag === hashtag)) next.hashtag = "This hashtag is already used. Choose another.";
    setErrors(next);
    if (next.name) document.getElementById("asset-name")?.focus(); else if (next.hashtag) document.getElementById("asset-tag")?.focus();
    return Object.keys(next).length === 0;
  }
  /** Saves the account (if new) and the asset. Returns the saved registry, or null when something needs attention (shown in `error` / `errors`). */
  async function save(): Promise<{ registry: Registry; assetId: string } | null> {
    if (!validate()) return null;
    setBusy(true); setError("");
    try {
      if (!pendingId && !draft.actualAccountId) throw new Error("Choose a saved off-budget account, or create one.");
      if (accountMode === "shared" && !/^#asset_[a-z0-9_-]{1,93}$/.test(hashtag)) throw new Error("Enter a unique hashtag such as #asset_family_car (lowercase letters, numbers, underscores or hyphens).");
      if (accountMode === "shared" && registry.assets.some((other) => other.id !== draft.id && other.assetTag === hashtag)) throw new Error("This hashtag is already used. Choose another.");
      const actualAccountId = pendingId ? await saveAccounts() : draft.actualAccountId;
      const directory = await getTransport(connection).getAccounts();
      const pending = useStagedStore.getState().accounts[actualAccountId ?? ""];
      if (pending && (pending.isNew || pending.isUpdated || pending.isDeleted || pending.pendingAccountClass !== undefined || pending.saveError)) throw new Error("Save pending changes to the selected account in Accounts first");
      const saved = await registryRequest(connection.budgetSyncId, "POST", { asset: { ...draft, actualAccountId, assetTag: accountMode === "shared" ? hashtag : null }, accountDirectory: directory });
      return { registry: saved, assetId: draft.id };
    } catch (e) { setError(e instanceof Error ? e.message : "Asset Save failed"); return null; }
    finally { setBusy(false); }
  }
  return {
    draft, setDraft, accountMode, setAccountMode, hashtag, setHashtag, error, setError, errors, setErrors, incomeTouched, setIncomeTouched, busy,
    accountOpen, setAccountOpen, createUncertain, pendingId, classes, groups, staged, initialAccount, accountOptions, hiddenAccounts, shared, unavailableReason,
    discard, close, stageAccount, discardPending, save, validate,
  };
}
