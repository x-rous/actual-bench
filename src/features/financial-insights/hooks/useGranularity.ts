"use client";

import { useState } from "react";
import { defaultGranularity, type Granularity } from "@/lib/financial-insights/buckets";

/**
 * The unit of a month-by-month card: the default for the length of the period, which follows the period when it changes, until
 * the viewer chooses one. A choice holds for the period it was made in; a different period opens by its own length again.
 */
export function useGranularity(monthCount: number): [Granularity, (g: Granularity) => void] {
  const [chosen, setChosen] = useState<{ monthCount: number; unit: Granularity } | null>(null);
  const unit = chosen && chosen.monthCount === monthCount ? chosen.unit : defaultGranularity(monthCount);
  return [unit, (g) => setChosen({ monthCount, unit: g })];
}
