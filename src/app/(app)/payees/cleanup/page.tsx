import type { Metadata } from "next";
import { PayeeCleanupView } from "@/features/payee-cleanup/components/PayeeCleanupView";

export const metadata: Metadata = {
  title: "Payee Cleanup - Actual Bench",
};

export default function PayeeCleanupPage() {
  return <PayeeCleanupView />;
}
