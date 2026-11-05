import type { ReactNode } from "react";
import { money, percent, signedMoney } from "../../format";
import { TipNote, TipRow, TipTitle } from "./Tip";

/**
 * The tooltip of one month of a bar chart: its values, how it compares with the previous complete month, its share of the
 * period and how many entries it holds. A partial month says so and is not compared with a full one; a change is only shown
 * when the previous value is not zero.
 */
export function monthTip({ title, partial, partialNote, rows, compare, share, entries }: {
  title: string;
  partial: boolean;
  partialNote: string;
  /** `strong` marks the row that is the total or the net, so it stands out from the parts. */
  rows: { colour?: string; name: ReactNode; value: ReactNode; strong?: boolean }[];
  /** The series the change is measured on, and the month's position in it. */
  compare?: { values: (number | null)[]; index: number; label: string };
  /** This month's part of a total, as a fraction of that total. */
  share?: { part: number; whole: number; of: string };
  entries?: number | null;
}): ReactNode {
  const prev = compare && compare.index > 0 ? compare.values[compare.index - 1] : null;
  const now = compare ? compare.values[compare.index] : null;
  return (
    <>
      <TipTitle>{title}{partial ? " (partial)" : ""}</TipTitle>
      {rows.map((r, i) => <TipRow key={i} colour={r.colour} name={r.name} value={r.value} strong={r.strong} />)}
      {(compare || share || entries != null || partial) && (
        <TipNote>
          {partial ? <span>{partialNote} Not compared with full months.</span> : (
            <>
              {compare && prev != null && now != null && <TipRow name={`vs previous month (${compare.label})`} value={`${signedMoney(now - prev)}${prev !== 0 ? ` · ${(now - prev >= 0 ? "+" : "−") + percent(Math.abs(((now - prev) / Math.abs(prev)) * 100))}` : ""}`} />}
              {share && share.whole !== 0 && <TipRow name={`Share of ${share.of}`} value={percent((Math.abs(share.part) / Math.abs(share.whole)) * 100)} />}
            </>
          )}
          {entries != null && <TipRow name="Entries" value={entries.toLocaleString()} />}
        </TipNote>
      )}
    </>
  );
}
export { money };
