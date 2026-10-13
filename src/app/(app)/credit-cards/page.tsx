import type { Metadata } from "next";
import { CreditCardWorkspace } from "@/features/credit-cards/components/CreditCardWorkspace";

export const metadata: Metadata = { title: "Credit Cards - Actual Bench" };

export default function CreditCardsPage() {
  return <CreditCardWorkspace />;
}
