"use client";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money, TransactionPickerPanel, type TransactionPickerPanelProps } from "./TransactionPickerPanel";

export type TransactionListProps = Omit<TransactionPickerPanelProps, "onSelectionChange" | "onListChange" | "readOnly" | "loadAll" | "multiple" | "autoSelect" | "onSubmit"> & {
  title: string;
  description?: ReactNode;
  /** What the listed rows should add up to (signed, as the list shows them); null when there is no single figure. */
  expectedMinor?: number | null;
  onClose: () => void;
};

/**
 * The app's transaction list in a dialog, to read: nothing can be selected, changed or linked. When the caller says what
 * the rows should add up to, the footer compares it with what is listed, and says so when they differ, so a figure and its
 * transactions can be checked against each other. A comparison is only made while the whole list is loaded and the user
 * has not narrowed it.
 */
export function TransactionListDialog({ title, description, expectedMinor = null, onClose, ...panel }: TransactionListProps) {
  const [list, setList] = useState<{ totalMinor: number; count: number; complete: boolean; narrowed: boolean } | null>(null);
  let verdict: ReactNode = null;
  if (expectedMinor !== null && list) {
    if (list.narrowed) verdict = <span className="text-muted-foreground">Part of the figure ({money(expectedMinor)}): the list is narrowed.</span>;
    else if (!list.complete) verdict = <span className="text-muted-foreground">Not every entry is loaded, so the total is not compared with the figure yet.</span>;
    else if (list.totalMinor === expectedMinor) verdict = <span className="font-medium text-foreground">Matches the figure ({money(expectedMinor)}).</span>;
    else verdict = <span role="alert" className="font-medium text-amber-700 dark:text-amber-400">Differs from the figure by {money(list.totalMinor - expectedMinor)}: the figure is {money(expectedMinor)}, these entries add up to {money(list.totalMinor)}.</span>;
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[min(56rem,94dvh)] flex-col gap-3 overflow-hidden sm:max-w-[min(94vw,90rem)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? "The entries behind this figure, read-only. Nothing here changes Actual."}</DialogDescription>
        </DialogHeader>
        <TransactionPickerPanel {...panel} readOnly loadAll={expectedMinor !== null} multiple={false} onSelectionChange={() => {}} onListChange={setList} />
        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p role="status" className="min-w-0 text-xs">{verdict}</p>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
