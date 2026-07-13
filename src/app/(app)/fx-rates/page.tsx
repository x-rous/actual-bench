import type { Metadata } from "next";
import { FxRatesView } from "@/features/fx/components/FxRatesView";

export const metadata: Metadata = {
  title: "FX Rates - Actual Bench",
};

export default function FxRatesPage() {
  return <FxRatesView />;
}
