import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { bankSyncMessage } from "../lib/bankSyncMessages";
import { sanitizeBankSyncError } from "@/lib/actual/bankSync";
import type { BankSyncOutcome } from "@/lib/actual/bankSync";

/**
 * "Sync banks now" (RD-080 / PR-044).
 *
 * Triggers Actual's own import. The transport is capability-gated, so a
 * connection that cannot do this reports it rather than silently doing nothing.
 */
export function useBankSync() {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();

  // The static capability says the *transport* implements the operation. Whether
  // the loaded Actual build exposes `runBankSync` is only knowable from the
  // runtime — which in Direct mode is already open by the time this page is
  // shown, so asking is cheap. Without this, an older build would be offered a
  // button that can only fail.
  const declared = connection
    ? getTransport(connection).getSyncCapabilities().capabilities.runBankSync
    : false;

  const availability = useQuery({
    queryKey: ["bankSyncAvailable", connection?.id, connection?.budgetSyncId],
    queryFn: async () => {
      if (!connection) return false;
      const transport = getTransport(connection);
      if (!transport.canRunBankSync) return Boolean(transport.runBankSync);
      return transport.canRunBankSync();
    },
    enabled: Boolean(connection) && declared,
    staleTime: 5 * 60_000,
  });

  // Requires a confirmed `true`: while the check is in flight (or if it failed)
  // `data` is undefined, and treating that as support would put the action in
  // front of someone before Bench knows it can do it.
  const supported = declared && availability.data === true;

  const mutation = useMutation({
    mutationFn: async (accountId?: string): Promise<BankSyncOutcome> => {
      if (!connection) throw new Error("No active connection");
      const transport = getTransport(connection);
      if (!transport.runBankSync) {
        return {
          status: "unsupported",
          results: [],
          countsObserved: false,
          message: "This connection cannot trigger a bank sync.",
        };
      }
      return transport.runBankSync({ accountId });
    },
    onSuccess: (outcome) => {
      const message = bankSyncMessage(outcome);
      const notify = message.tone === "error" ? toast.error : message.tone === "warning" ? toast.warning : toast.success;
      notify(message.text, message.detail ? { description: message.detail } : undefined);

      // Balances and transactions may have moved; let the page reflect it.
      void queryClient.invalidateQueries({ queryKey: ["accountBalances"] });
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    // Per-account failures are sanitized inside the run; an error thrown
    // *before* the loop — opening the runtime, downloading the budget, the
    // account read — arrives raw from the server and can carry URL userinfo or
    // credential-shaped text. Same rule, both paths.
    onError: (error: Error) => toast.error(sanitizeBankSyncError(error)),
  });

  return { supported, syncBanks: mutation.mutate, isSyncing: mutation.isPending };
}
