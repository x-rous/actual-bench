import type { Metadata } from "next";
import { AssetsDebtOverview } from "@/features/assets-debt/components/AssetsDebtViews";

export const metadata: Metadata = {
  title: "Assets & Debt - Actual Bench",
};

export default function AssetsDebtPage() {
  return <AssetsDebtOverview />;
}
