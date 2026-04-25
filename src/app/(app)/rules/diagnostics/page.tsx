import type { Metadata } from "next";
import { RuleDiagnosticsView } from "@/features/rule-diagnostics/components/RuleDiagnosticsView";

export const metadata: Metadata = {
  title: "Rule Diagnostics — Actual Bench",
};

export default function RuleDiagnosticsPage() {
  return <RuleDiagnosticsView />;
}
