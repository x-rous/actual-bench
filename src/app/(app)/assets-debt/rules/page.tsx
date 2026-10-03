import type { Metadata } from "next";
import { RulesView } from "@/features/assets-debt/components/rules/RulesView";

export const metadata: Metadata = {
  title: "Assets & Debt rules - Actual Bench",
};

export default function RulesPage() {
  return <RulesView />;
}
