import type { Metadata } from "next";
import { LaterPhaseView } from "@/features/assets-debt/components/AssetsDebtViews";

export const metadata: Metadata = {
  title: "Assets - Actual Bench",
};

export default function AssetsPage() {
  return <LaterPhaseView title="Assets" description="The asset registry and valuations arrive in a later phase." />;
}
