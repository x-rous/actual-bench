import type { Metadata } from "next";
import { AutomationsView } from "@/features/automations/components/AutomationsView";

export const metadata: Metadata = {
  title: "Automations - Actual Bench",
};

export default function AutomationsPage() {
  return <AutomationsView />;
}
