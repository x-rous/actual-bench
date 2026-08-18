import type { Metadata } from "next";
import { PayeeCleanupClient } from "./PayeeCleanupClient";

export const metadata: Metadata = {
  title: "Payee Cleanup - Actual Bench",
};

export default function PayeeCleanupPage() {
  return <PayeeCleanupClient />;
}
