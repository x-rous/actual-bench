import { redirect } from "next/navigation";

/** Moved to /loans/new. */
export default function OldNewLoanPage() {
  redirect("/loans/new");
}
