import { redirect } from "next/navigation";

/** Repayment matching lives in each loan's Settings; the old link opens the loans list. */
export default function RulesPage() {
  redirect("/loans");
}
