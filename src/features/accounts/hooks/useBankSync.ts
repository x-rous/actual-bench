import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { bankSyncMessage } from "../lib/bankSyncMessages";
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

  const supported = connection ? getTransport(connection).getSyncCapabilities().capabilities.runBankSync : false;

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
    onError: (error: Error) => toast.error(error.message),
  });

  return { supported, syncBanks: mutation.mutate, isSyncing: mutation.isPending };
}
