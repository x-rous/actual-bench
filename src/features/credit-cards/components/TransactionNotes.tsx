/** Notes are immediately readable; no disclosure control hides source information. */
export function TransactionNotes({ notes }: { notes: string | null }) {
  return notes ? <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{notes}</p> : <span className="text-muted-foreground">-</span>;
}
