"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { MultiSearchableCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accountRole, isBorrowing, type Snapshot } from "@/lib/cashflow-planning/actuals";
import { NAME_MAX, createRow } from "@/lib/cashflow-planning/document";
import { SECTION_LABEL, type PlanDocument, type PlanRow, type SectionId } from "@/lib/cashflow-planning/types";

/**
 * A new row starts from what it follows in Actual, so it shows history and a forecast straight away; with nothing chosen it is
 * a row to type into. The name follows the first choice until the user types one.
 */
export function AddRowDialog({ doc, snapshot, section, groupId, onAdd, onClose }: { doc: PlanDocument; snapshot: Snapshot | null; section: SectionId; groupId: string | null; onAdd: (row: PlanRow) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [categoryValues, setCategoryValues] = useState<string[]>([]);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const live = doc.useActuals && snapshot;

  // What another row already follows is still offered, but marked: following it twice has no effect.
  const taken = useMemo(() => new Set(doc.rows.flatMap((r) => [...r.links.categories, ...r.links.categoryGroups.map((g) => `group:${g}`), ...r.links.accounts.filter((a) => !a.flow).map((a) => `account:${a.id}`)])), [doc.rows]);
  const categoryOptions = useMemo((): ComboboxOption[] => {
    const options: ComboboxOption[] = [];
    let group = "";
    for (const c of snapshot?.categories ?? []) {
      // Income categories for an income row, the others elsewhere: the usual choice first, never the only one.
      if ((section === "income") !== c.isIncome) continue;
      if (c.groupId !== group) { group = c.groupId; options.push({ id: `group:${c.groupId}`, name: c.groupName, isGroupHeader: true, trailing: taken.has(`group:${c.groupId}`) ? "in a row" : undefined }); }
      options.push({ id: c.id, name: c.name, hidden: c.hidden, trailing: taken.has(c.id) ? "in a row" : undefined });
    }
    return options;
  }, [snapshot, section, taken]);
  const accountOptions = useMemo((): ComboboxOption[] => {
    const all = snapshot?.accounts ?? [];
    const item = (a: Snapshot["accounts"][number]): ComboboxOption => ({ id: a.id, name: a.name, hidden: a.closed, trailing: taken.has(`account:${a.id}`) ? "in a row" : a.closed ? "closed" : undefined });
    const outside = all.filter((a) => accountRole(doc, a) !== "cash"), inside = all.filter((a) => accountRole(doc, a) === "cash");
    return [
      ...(outside.length ? [{ id: "h:outside", name: "Transfers between cash and…", isGroupHeader: true as const }, ...outside.map(item)] : []),
      ...(inside.length ? [{ id: "h:inside", name: "Uncategorized entries in…", isGroupHeader: true as const }, ...inside.map(item)] : []),
    ];
  }, [snapshot, doc, taken]);

  const suggested = useMemo(() => {
    const first = categoryValues[0];
    if (first?.startsWith("group:")) return snapshot?.categories.find((c) => c.groupId === first.slice(6))?.groupName ?? "";
    if (first) return snapshot?.categories.find((c) => c.id === first)?.name ?? "";
    return snapshot?.accounts.find((a) => a.id === accountIds[0])?.name ?? "";
  }, [categoryValues, accountIds, snapshot]);
  const linked = categoryValues.length + accountIds.length > 0;
  const finalName = name.trim() || suggested || "New row";
  const group = groupId ? doc.groups.find((g) => g.id === groupId) : null;

  const add = () => {
    // A loan with a schedule in Loans is forecast from it; anything else followed in Actual starts from its own recent months.
    const loan = accountIds.length > 0 && accountIds.every((id) => snapshot?.loans[id]?.state === "ready") && categoryValues.length === 0;
    onAdd(createRow({
      name: finalName, section, groupId,
      basis: !linked ? { kind: "manual" } : loan ? { kind: "loan" } : { kind: "average", months: 12 },
      links: { categoryGroups: categoryValues.filter((v) => v.startsWith("group:")).map((v) => v.slice(6)), categories: categoryValues.filter((v) => !v.startsWith("group:")), 
        // In the Income section a loan is followed for the money borrowed from it; elsewhere for its repayments.
        accounts: accountIds.map((id) => { const account = snapshot?.accounts.find((a) => a.id === id); return isBorrowing(account, account ? accountRole(doc, account) : undefined) ? { id, flow: section === "income" ? "in" as const : "out" as const } : { id }; }),
      },
    }));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a row to {group ? group.name : SECTION_LABEL[section]}</DialogTitle>
          <DialogDescription>{live ? "Choose what the row follows in Actual, or leave both empty for a row you type into. You can change this later." : "This plan does not use Actual, so the row is one you type into."}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
          {live && (
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium">Categories</span>
                <MultiSearchableCombobox ariaLabel="Categories the row follows" selectableGroups options={categoryOptions} values={categoryValues} onChange={setCategoryValues} placeholder="No categories" triggerClassName="w-full" />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium">Accounts</span>
                <MultiSearchableCombobox ariaLabel="Accounts the row follows" options={accountOptions} values={accountIds} onChange={setAccountIds} placeholder="No accounts" triggerClassName="w-full" />
              </div>
            </>
          )}
          <div className="space-y-1.5"><Label htmlFor="cf-add-name">Name</Label><Input id="cf-add-name" autoFocus={!live} value={name} maxLength={NAME_MAX} placeholder={suggested || "New row"} onChange={(e) => setName(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">{!linked ? "Its coming months are what you type or set to repeat." : "Its coming months start from the average of its last 12 months; change that on the row's Forecast tab."}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add row</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
