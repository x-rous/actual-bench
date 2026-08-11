import type { Metadata } from "next";
import { ReconciliationView } from "@/features/reconciliation/components/ReconciliationView";

export const metadata: Metadata = {
  title: "Bank Reconciliation - Actual Bench",
};

export default function ReconciliationPage() {
  return <ReconciliationView />;
}
