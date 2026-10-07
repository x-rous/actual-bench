import { redirect } from "next/navigation";

/** Loans & Debt and Assets are separate pages now; the old combined page opens Loans & Debt. */
export default function AssetsDebtPage() {
  redirect("/loans");
}
