"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accountRole, isBorrowing, type Snapshot } from "@/lib/cashflow-planning/actuals";
import { NAME_MAX, createRow } from "@/lib/cashflow-planning/document";
import { SECTION_LABEL, type Basis, type PlanDocument, type PlanRow, type RowLinks, type SectionId } from "@/lib/cashflow-planning/types";
import { BasisBlock, LinksBlock } from "./Inspector";

/**
 * A new row starts from what it follows in Actual, so it shows history and a forecast straight away; with nothing chosen it is
 * a row to type into. It uses the same Follows in Actual and Forecast controls as the details panel. The name follows the first
 * choice until the user types one, and the forecast follows the choice until the user picks one.
 */
export function AddRowDialog({ doc, snapshot, section, groupId, onAdd, onClose }: { doc: PlanDocument; snapshot: Snapshot | null; section: SectionId; groupId: string | null; onAdd: (row: PlanRow) => void; onClose: () => void }) {
  const live = doc.useActuals && snapshot;
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<PlanRow>(() => createRow({ name: "", section, groupId }));
  const [basisTouched, setBasisTouched] = useState(false);

  // A loan with a schedule in Loans is forecast from it; anything else followed in Actual starts from its own recent months.
  const autoBasis = (links: RowLinks): Basis => {
    const linked = links.categories.length + links.categoryGroups.length + links.accounts.length > 0;
    const loan = links.accounts.length > 0 && links.categories.length + links.categoryGroups.length === 0 && links.accounts.every((l) => snapshot?.loans[l.id]?.state === "ready");
    return !linked ? { kind: "manual" } : loan ? { kind: "loan" } : { kind: "average", months: 12 };
  };
  const edit = (change: (row: PlanRow) => PlanRow) => {
    const next = change(draft);
    const basisChanged = next.basis !== draft.basis;
    if (basisChanged) setBasisTouched(true);
    setDraft(!basisChanged && !basisTouched ? { ...next, basis: autoBasis(next.links) } : next);
  };

  const suggested = useMemo(() => {
    const first = draft.links.categoryGroups[0] ?? draft.links.categories[0];
    if (draft.links.categoryGroups[0]) return snapshot?.categories.find((c) => c.groupId === first)?.groupName ?? "";
    if (first) return snapshot?.categories.find((c) => c.id === first)?.name ?? "";
    return snapshot?.accounts.find((a) => a.id === draft.links.accounts[0]?.id)?.name ?? "";
  }, [draft.links, snapshot]);
  const group = groupId ? doc.groups.find((g) => g.id === groupId) : null;

  const add = () => {
    onAdd({
      ...draft, name: (name.trim() || suggested || "New row").slice(0, NAME_MAX),
      // In the Income section a loan is followed for the money borrowed from it; elsewhere for its repayments.
      links: { ...draft.links, accounts: draft.links.accounts.map((link) => { const account = snapshot?.accounts.find((a) => a.id === link.id); return !link.flow && isBorrowing(account, account ? accountRole(doc, account) : undefined) ? { id: link.id, flow: section === "income" ? "in" as const : "out" as const } : link; }) },
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 px-5 pb-3 pt-5">
          <DialogTitle>Add a row to {group ? group.name : SECTION_LABEL[section]}</DialogTitle>
          <DialogDescription>{live ? "Choose what the row follows in Actual, or leave both empty for a row you type into. You can change this later." : "This plan does not use Actual, so the row is one you type into."}</DialogDescription>
        </DialogHeader>
        <form id="cf-add-row" className="min-h-0 flex-1 divide-y divide-border overflow-y-auto border-t border-border px-5 text-xs [&>section]:py-4 [&>div]:py-4" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <div className="space-y-1.5"><Label htmlFor="cf-add-name" className="text-xs">Name</Label><Input id="cf-add-name" autoFocus value={name} maxLength={NAME_MAX} placeholder={suggested || "New row"} onChange={(e) => setName(e.target.value)} /></div>
          {live && <LinksBlock doc={doc} snapshot={snapshot} row={draft} edit={edit} />}
          <BasisBlock doc={doc} snapshot={snapshot ?? null} row={draft} typical={null} edit={edit} />
        </form>
        <DialogFooter className="shrink-0 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="cf-add-row">Add row</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
