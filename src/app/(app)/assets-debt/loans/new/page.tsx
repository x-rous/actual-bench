import type { Metadata } from "next";
import { NewDebtView } from "@/features/assets-debt/components/AssetsDebtViews";

export const metadata: Metadata = {
  title: "New debt - Actual Bench",
};

export default function NewDebtPage() {
  return <NewDebtView />;
}
