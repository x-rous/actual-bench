import type { Metadata } from "next";
import { PayeesView } from "@/features/payees/components/PayeesView";

export const metadata: Metadata = {
  title: "Payees — Actual Bench",
};

export default function PayeesPage() {
  return <PayeesView />;
}
