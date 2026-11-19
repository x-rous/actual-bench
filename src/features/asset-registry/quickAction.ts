/**
 * Hands a row action chosen on the registry list to the asset page it opens (client navigation, same window). The page
 * can mount more than once while it loads (Direct mode shows its runtime gate first), so reading does not clear it: the
 * page clears it once the editor has opened. An action not used within a minute is ignored, and a reload never sees one.
 */
export type QuickAction = "set-value" | "create" | "payment";
let pending: { assetId: string; action: QuickAction; at: number } | null = null;
export function setQuickAction(next: { assetId: string; action: QuickAction }) { pending = { ...next, at: Date.now() }; }
export function readQuickAction(assetId: string | undefined): QuickAction | null {
  return pending && assetId && pending.assetId === assetId && Date.now() - pending.at < 60_000 ? pending.action : null;
}
export function clearQuickAction() { pending = null; }
