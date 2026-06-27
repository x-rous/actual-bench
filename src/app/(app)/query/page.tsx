import type { Metadata } from "next";
import { QueryWorkspace } from "@/features/query/components/QueryWorkspace";

export const metadata: Metadata = {
  title: "ActualQL Queries - Actual Bench",
};

export default function QueryPage() {
  return <QueryWorkspace />;
}
