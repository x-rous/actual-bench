import { redirect } from "next/navigation";

/** What needs attention is now a filter on the Loans & Debt list. */
export default function OldActivityPage() {
  redirect("/loans?filter=attention");
}
