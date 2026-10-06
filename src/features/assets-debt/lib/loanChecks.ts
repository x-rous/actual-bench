"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { loanStatusKey, runLoanRefresh } from "../components/workspace/useBackgroundRefresh";
import { getDebt } from "./debtsApi";
import { useAccountDirectory } from "./useAccountDirectory";

/**
 * The loans list checks Actual on its own (owner decision 2026-10-07): each active loan is read and
 * re-planned quietly, one at a time, at most every 10 minutes, so "changes to review" shows new
 * repayments without opening each loan. Loans with offset accounts are left to their own page (their
 * plan needs the offset histories it reads). Read only in Actual, as every refresh is.
 */

const EVERY_MS = 10 * 60_000;
const checkedKey = (server: string, budget: string, id: string) => `ab:loan-checked:v1:${server}:${budget}:${id}`;
const today = () => new Date().toISOString().slice(0, 10);

function lastChecked(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function useBackgroundLoanChecks(debts: readonly DebtSummary[] | undefined): { checking: string | null } {
  const connection = useConnectionStore(selectActiveInstance);
  const directory = useAccountDirectory();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !debts || !connection?.budgetSyncId || !directory.data) return;
    started.current = true;
    const budget = connection.budgetSyncId;
    const due = debts.filter((d) => d.status === "active" && !d.blocked && !d.paidOffOn && d.liabilityAccountId && Date.now() - lastChecked(checkedKey(connection.baseUrl, budget, d.id)) > EVERY_MS);
    if (!due.length) return;
    void (async () => {
      for (const summary of due) {
        setChecking(summary.name);
        try {
          const debt = await getDebt(summary.id);
          if (debt.offsets.length || !debt.config.ok) continue;
          await runLoanRefresh({
            connection, directory: directory.data!, debt, from: debt.config.config.terms.openingDate, to: today(),
            cacheKey: loanStatusKey({ baseUrl: connection.baseUrl, budgetSyncId: budget, debtId: debt.debt.id, revision: debt.debt.currentRevision }),
          });
          try {
            localStorage.setItem(checkedKey(connection.baseUrl, budget, summary.id), String(Date.now()));
          } catch {
            // storage unavailable: checked again next visit
          }
          void queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", summary.id] });
        } catch {
          // One loan failing never stops the others; its own page shows why.
        }
      }
      setChecking(null);
      void queryClient.invalidateQueries({ queryKey: ["assets-debt", "attention"] });
    })();
  }, [debts, connection, directory.data, queryClient]);

  return { checking };
}
