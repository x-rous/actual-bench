"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import { createDebt, DebtApiError, updateDebt } from "../../lib/debtsApi";
import { toSaveInput, type EditorIssue, type EditorState } from "../../lib/editorModel";
import { EditorFooter } from "./EditorFooter";
import { TextField } from "./fields";
import { BasicsSection, CategoriesSection, ComponentsSection, ContractTermsSection, OffsetsSection, ProfileSection, RepaymentsSection } from "./sections";

/**
 * The loan editor (RD-084 P1.3; US1, US2). Saves Bench configuration only:
 * the request carries the account directory read through the ledger port,
 * and the server validates against it. No path from here writes to Actual.
 */
export function DebtEditor({
  initial,
  debtId,
  directory,
  onSaved,
  onCancel,
}: {
  initial: EditorState;
  debtId: string | null;
  directory: AccountDirectory | undefined;
  onSaved: (detail: DebtDetail) => void;
  onCancel?: () => void;
}) {
  const [state, setState] = useState(initial);
  const [issues, setIssues] = useState<EditorIssue[]>([]);
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: async () => {
      const built = toSaveInput(state);
      if (!built.ok) throw new DebtApiError("Some fields need attention.", 400, built.issues);
      if (!directory) throw new DebtApiError("The budget's accounts have not loaded yet.", 400);
      return debtId ? updateDebt(debtId, built.input, directory) : createDebt(built.input, directory);
    },
    onSuccess: (detail) => {
      setIssues([]);
      void queryClient.invalidateQueries({ queryKey: ["assets-debt"] });
      toast.success(debtId ? `Saved revision ${detail.debt.currentRevision}` : "Debt saved");
      onSaved(detail);
    },
    onError: (error) => {
      if (error instanceof DebtApiError && error.issues.length) setIssues(error.issues);
      else toast.error(error instanceof Error ? error.message : "The debt could not be saved");
    },
  });

  const props = { state, update: (change: (s: EditorState) => EditorState) => setState(change), issues, directory };
  const unplaced = issues.filter((i) => i.field === "accountDirectory" || i.field === "(body)");

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      aria-label={debtId ? `Edit ${state.name || "debt"}` : "New debt"}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        {issues.length > 0 ? (
          <div role="alert" className="mx-4 mt-3 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            <p className="font-medium">The debt was not saved: {issues.length === 1 ? "one field needs" : `${issues.length} fields need`} attention. Each problem is shown in its section.</p>
            {unplaced.map((i) => (
              <p key={i.message}>{i.message}</p>
            ))}
          </div>
        ) : null}
        <BasicsSection {...props} />
        <ContractTermsSection {...props} />
        <ProfileSection {...props} />
        <RepaymentsSection {...props} />
        <ComponentsSection {...props} />
        <OffsetsSection {...props} />
        <CategoriesSection {...props} />
        {debtId ? (
          <div className="px-4 py-3">
            <TextField label="What changed (optional)" value={state.changeSummary} onChange={(v) => setState((s) => ({ ...s, changeSummary: v }))} hint="Recorded with the new revision when the change affects the calculation." />
          </div>
        ) : null}
      </div>
      <EditorFooter saving={save.isPending} onCancel={onCancel} saveLabel={debtId ? "Save changes" : "Save debt"} />
    </form>
  );
}
