"use client";

import type { ComponentProps } from "react";
import { AnalysisHeader } from "../analysis/AnalysisHeader";

/** Variance Drivers' header: the shared analysis header with this dialog's title. */
export function VarianceHeader(props: Omit<ComponentProps<typeof AnalysisHeader>, "title">) {
  return <AnalysisHeader title="Variance Drivers" {...props} />;
}
