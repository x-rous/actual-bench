import { Button } from "@/components/ui/button";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import { dt } from "./presentation";

/** The same payment details wherever an excluded payment can be restored. */
export function IgnoredPaymentCard({ row, accountName, money, onRestore }: {
  row: SyncSourceTransaction | null;
  accountName: (id: string) => string;
  money: (minor: number) => string;
  onRestore: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3 text-xs">
      {row ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold tabular-nums">{dt(row.date)} · {money(Math.abs(row.amount))}</span>
            <Button size="xs" variant="outline" onClick={onRestore} aria-label={`Restore payment ${dt(row.date)} ${money(Math.abs(row.amount))}`}>Restore</Button>
          </div>
          <p className="mt-1.5 break-words text-muted-foreground">{accountName(row.accountId)}{row.payeeName ? ` → ${row.payeeName}` : ""}</p>
          {row.notes ? <p className="mt-2 rounded bg-muted/50 px-2 py-1.5 break-words text-muted-foreground">{row.notes}</p> : null}
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Payment details are unavailable in the current Actual read.</span>
          <Button size="xs" variant="outline" onClick={onRestore} aria-label="Restore unavailable payment">Restore</Button>
        </div>
      )}
    </div>
  );
}
