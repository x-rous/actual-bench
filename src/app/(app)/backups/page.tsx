import type { Metadata } from "next";
import { BackupsView } from "@/features/backups/components/BackupsView";

export const metadata: Metadata = {
  title: "Backups - Actual Bench",
};

export default function BackupsPage() {
  return <BackupsView />;
}
