import { redirect } from "next/navigation";

/** Repayment matching moved to each loan's own tab; the old link opens the loans list. */
export default function RulesPage() {
  redirect("/assets-debt/loans");
}
