import type { Metadata } from "next";
import { SyncView } from "@/features/sync/components/SyncView";

export const metadata: Metadata = {
  title: "Budget File Sync - Actual Bench",
};

export default function SyncPage() {
  return <SyncView />;
}
