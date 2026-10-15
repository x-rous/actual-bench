"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/features/assets-debt/lib/money";
import { activityKind, type ActivitySnapshot } from "../lib/activity";
import type { Card, Workspace } from "../lib/models";
import { formatCardDate } from "../lib/displayDates";
import { currentPlanLink } from "../lib/plans";
import { classificationLabels } from "../lib/classifications";
import { ActivityClassification } from "./ActivityClassification";
import { BulkClassification } from "./BulkClassification";
import { ReviewText } from "./ReviewText";
export function ActivityTable({ budget, card, workspace, snapshot, available, onMappings }: { budget: string; card: Card; workspace: Workspace; snapshot: ActivitySnapshot; available: boolean; onMappings: () => void }) {
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const unclassified = snapshot.rows.filter((row) => ["unclassified", "ambiguous"].includes(activityKind(row, card, workspace, snapshot)));
  const unclassifiedIds = new Set(unclassified.map((row) => row.id));
  const rows = snapshot.rows.filter((row) => (!filter || unclassifiedIds.has(row.id)) && [row.label, row.notes ?? "", row.categoryName ?? "", classificationLabels[activityKind(row, card, workspace, snapshot)], formatCardDate(row.date), formatAmount(row.amountMinor, 2)].join(" ").toLowerCase().includes(search.toLowerCase()));
  const selectedRows = snapshot.rows.filter((row) => selected.has(row.id));
  const canSelect = (row: typeof rows[number]) => activityKind(row, card, workspace, snapshot) !== "payment" && !currentPlanLink(workspace, row) && row.amountMinor !== 0;
  const selectable = rows.filter(canSelect);
  return <div className="space-y-3"><BulkClassification budget={budget} card={card} workspace={workspace} snapshot={snapshot} rows={snapshot.rows} selected={selectedRows} available={available} onMappings={onMappings} onDone={() => setSelected(new Set())} /><div className="flex flex-wrap gap-2"><Input className="max-w-sm" aria-label="Search activity classification" placeholder="Search activity…" value={search} onChange={(event) => setSearch(event.target.value)} /><Select aria-label="Activity classification filter" value={filter} onValueChange={setFilter} options={[{ value: "", label: "All classifications" }, { value: "unclassified", label: `Unclassified (${unclassified.length})` }]} />{selected.size > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection ({selected.size})</Button>}</div><div className="overflow-auto"><table className="w-full min-w-[1050px] table-fixed text-left text-[13px] [&_td]:px-2 [&_td]:py-2 [&_td]:align-middle"><caption className="sr-only">Actual card activity classification</caption><colgroup>{["3%", "11%", "17%", "31%", "10%", "9%", "19%"].map((width, index) => <col key={index} style={{ width }} />)}</colgroup><thead className="bg-muted/30"><tr><th className="w-8 p-2"><Checkbox aria-label="Select visible activity" checked={selectable.length > 0 && selectable.every((row) => selected.has(row.id))} onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); for (const row of selectable) if (checked) next.add(row.id); else next.delete(row.id); return next; })} /></th>{["Date", "Payee", "Notes", "Amount", "Cleared", "Classification"].map((label) => <th key={label} className="p-2 font-medium">{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td><Checkbox aria-label={`Select activity ${row.id}`} disabled={!canSelect(row)} checked={selected.has(row.id)} onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(row.id); else next.delete(row.id); return next; })} /></td><td>{formatCardDate(row.date)}</td><td><ReviewText text={row.label} label="activity payee" /></td><td><ReviewText text={row.notes ?? "-"} label="activity notes" /></td><td className={`text-right tabular-nums ${row.amountMinor < 0 ? "text-destructive" : ""}`}>{formatAmount(row.amountMinor, 2)}</td><td>{row.cleared === null ? "Unknown" : row.cleared ? "Cleared" : "Pending"}</td><td><ActivityClassification compact budget={budget} card={card} row={row} workspace={workspace} snapshot={snapshot} available={available} /></td></tr>)}</tbody></table>{!rows.length && <p className="p-3 text-xs text-muted-foreground">No activity matches these filters.</p>}</div></div>;
}
