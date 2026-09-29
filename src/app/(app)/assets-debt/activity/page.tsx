import type { Metadata } from "next";
import { LaterPhaseView } from "@/features/assets-debt/components/AssetsDebtViews";

export const metadata: Metadata = {
  title: "Assets & Debt activity - Actual Bench",
};

export default function ActivityPage() {
  return <LaterPhaseView title="Activity" description="Proposals, postings and reconciliation history arrive in a later phase." />;
}
