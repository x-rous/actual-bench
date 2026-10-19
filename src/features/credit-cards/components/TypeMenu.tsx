"use client";
import { useState } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ActivityRow, ActivitySnapshot } from "../lib/activity";
import type { Card, TransactionType, Workspace } from "../lib/models";
import { planEligibleKinds, sourceLabels, typeChoices, typeLabel } from "../lib/classifications";
import { currentPlanEntry, planForTransaction, typeCorrectionFor } from "../lib/derive/indexes";
import { transactionType } from "../lib/derive/types";
import { creditCardStore } from "../lib/store/store";
import { money, shortDate } from "./primitives/format";
import { transferOwnership } from "./planLink";

type Props = {
  budget: string;
  card: Card;
  row: ActivityRow;
  workspace: Workspace;
  snapshot: ActivitySnapshot;
  available: boolean;
  anchor: Element;
  onClose: () => void;
  onMakePlan?: (rowId: string) => void;
  onLinkPlan?: (rowIds: string[]) => void;
  /** In statement review the choice is staged and saved with the review (D29). */
  onStage?: (kind: TransactionType | null, note: string | null) => void;
};

/**
 * The one type menu for a table (§9.9), opened from the chip or with T. It explains the
 * suggestion, offers "Use suggestion" and takes an optional note. The Actual category never
 * changes.
 */
export function TypeMenu({ budget, card, row, workspace, snapshot, available, anchor, onClose, onMakePlan, onLinkPlan, onStage }: Props) {
  const type = transactionType(row, card, workspace, snapshot);
  const saved = typeCorrectionFor(workspace, card.id, row);
  const [kind, setKind] = useState<TransactionType>(saved?.kind ?? type.kind);
  const [note, setNote] = useState(saved?.note ?? "");
  const [error, setError] = useState("");
  const [makePlan, setMakePlan] = useState(false);
  const plan = planForTransaction(workspace, row.id);
  // Plan-account transfers and linked instalments are typed by their plan: say why and where to change it.
  const ownership = transferOwnership(row, workspace, snapshot);
  const fixed = ownership ?? (plan && currentPlanEntry(workspace, row)?.role === "instalment"
    ? `Typed by plan ${plan.name} as an instalment. Unlink it in the plan to change its type.` : null);
  const canPlan = Boolean(onMakePlan) && !plan && row.amountMinor < 0 && planEligibleKinds.includes(kind);

  async function apply(next: TransactionType | null) {
    try {
      if (onStage) onStage(next, note || null);
      else {
        if (!available) throw new Error("Refresh Actual before changing types");
        await creditCardStore.getState().setTypes(budget, card.id, snapshot, [{ transactionId: row.id, kind: next, note: note || null }]);
      }
      onClose();
      // "Make this a plan": the plan editor opens straight after the type is set.
      if (next && makePlan && canPlan) onMakePlan?.(row.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change the type");
    }
  }

  return <PopoverPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner anchor={anchor} side="bottom" align="start" sideOffset={4} className="z-[80]">
        <PopoverPrimitive.Popup
          aria-label={`Type of ${row.label}`}
          className="w-72 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none"
        >
          <p className="font-medium">{row.label} · {shortDate(row.date)} · {money(row.amountMinor)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{sourceLabels[type.source]}: {typeLabel(type.kind, row.amountMinor)}. {type.reason}</p>
          {fixed ? <p className="mt-2 text-xs">{fixed}</p> : <>
            {saved && <Button size="sm" variant="outline" className="mt-2 w-full justify-start" disabled={!available && !onStage} onClick={() => apply(null)}>
              Use suggestion
            </Button>}
            {type.source === "suggested" && <Button size="sm" className="mt-2 w-full justify-start" disabled={!available && !onStage}
              onClick={() => apply(type.kind)}>
              Accept suggestion · {typeLabel(type.kind, row.amountMinor)}
            </Button>}
            <div role="radiogroup" aria-label="Type" className="mt-2 grid grid-cols-2 gap-1">
              {typeChoices(row).map((choice) => <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={kind === choice}
                onClick={() => setKind(choice)}
                className={cn("h-7 rounded border px-2 text-left text-xs",
                  kind === choice ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
              >{typeLabel(choice, row.amountMinor)}</button>)}
            </div>
            <label className="mt-2 block text-xs text-muted-foreground">Note (optional)
              <Input size="sm" className="mt-1" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
            </label>
            {canPlan && <label className="mt-2 flex items-center gap-2 text-xs">
              <Checkbox checked={makePlan} onCheckedChange={setMakePlan} />Make this a plan
            </label>}
            {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button size="sm" disabled={!available && !onStage} onClick={() => apply(kind)}>Set type</Button>
            </div>
          </>}
          {onLinkPlan && !row.transferId && <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
            {onLinkPlan && !row.transferId && <Button size="xs" variant="outline" onClick={() => { onClose(); onLinkPlan([row.id]); }}>
              {plan ? `Plan ${plan.name}…` : "Link to plan…"}
            </Button>}
          </div>}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}
