import type { Metadata } from "next";
import { AccountsView } from "@/features/accounts/components/AccountsView";

export const metadata: Metadata = {
  title: "Accounts — Actual Bench",
};

export default function AccountsPage() {
  return <AccountsView />;
}
