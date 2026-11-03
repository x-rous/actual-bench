"use client";

import { PillGroup } from "@/components/ui/pill-group";
import type { Granularity } from "@/lib/financial-insights/buckets";

const UNIT_OPTIONS = [{ value: "month", label: "Mo", title: "Monthly" }, { value: "quarter", label: "Qtr", title: "Quarterly" }, { value: "year", label: "Yr", title: "Yearly" }];

/** The pills that choose the unit of a card that reads month by month: months, calendar quarters or calendar years. */
export function UnitPills({ value, onChange, label }: { value: Granularity; onChange: (g: Granularity) => void; label: string }) {
  return <div role="group" aria-label={label}><PillGroup options={UNIT_OPTIONS} value={value} onChange={(v) => onChange(v as Granularity)} /></div>;
}
