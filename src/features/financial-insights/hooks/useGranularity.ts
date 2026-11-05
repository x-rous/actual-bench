"use client";

import { useState } from "react";
import { defaultGranularity, type Granularity } from "@/lib/financial-insights/buckets";

/**
 * The unit of a month-by-month card: the default for the length of the period, which follows the period when it changes, until
 * the viewer chooses one. A choice holds for the period it was made in; a different period opens by its own length again.
 */
export function useGranularity(months: readonly string[]): [Granularity, (g: Granularity) => void] {
  // The period is told apart by its first and last month (a different run of the same length is a different period).
  const key = `${months[0] ?? ""}|${months[months.length - 1] ?? ""}`;
  const [chosen, setChosen] = useState<{ key: string; unit: Granularity } | null>(null);
  const unit = chosen && chosen.key === key ? chosen.unit : defaultGranularity(months.length);
  return [unit, (g) => setChosen({ key, unit: g })];
}
