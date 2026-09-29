import type { Metadata } from "next";
import { LaterPhaseView } from "@/features/assets-debt/components/AssetsDebtViews";

export const metadata: Metadata = {
  title: "Assets & Debt rules - Actual Bench",
};

export default function RulesPage() {
  return <LaterPhaseView title="Rules" description="Matching rules for repayments and lender transactions arrive in a later phase." />;
}
