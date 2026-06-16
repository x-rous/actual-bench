import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SkipReason } from "../csv/rulesCsvImport";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imported: number;
  skipped: number;
  skipReasons: SkipReason[];
};

export function RulesImportResultDialog({ open, onOpenChange, imported, skipped, skipReasons }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Results</DialogTitle>
          <DialogDescription>
            {imported} rule{imported !== 1 ? "s" : ""} imported
            {skipped > 0 ? `, ${skipped} skipped` : ""}.
          </DialogDescription>
        </DialogHeader>

        {skipReasons.length > 0 && (
          <div className="max-h-96 overflow-y-auto rounded border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Rule ID</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Reason skipped</th>
                </tr>
              </thead>
              <tbody>
                {skipReasons.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{r.ruleGroupId}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
