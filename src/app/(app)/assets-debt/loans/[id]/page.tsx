import type { Metadata } from "next";
import { DebtDetailView } from "@/features/assets-debt/components/AssetsDebtViews";

export const metadata: Metadata = {
  title: "Debt - Actual Bench",
};

export default async function DebtPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DebtDetailView id={id} />;
}
