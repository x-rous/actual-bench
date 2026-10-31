import { redirect } from "next/navigation";

/** Loans and Assets are separate pages now; the old combined page opens Loans. */
export default function AssetsDebtPage() {
  redirect("/loans");
}
