import { redirect } from "next/navigation";

/** Moved to /loans/[id]; the tab and filter in the old link are kept. */
export default async function OldLoanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => (value === undefined ? [] : Array.isArray(value) ? value.map((v) => [key, v]) : [[key, value]]))).toString();
  redirect(`/loans/${encodeURIComponent(id)}${query ? `?${query}` : ""}`);
}
