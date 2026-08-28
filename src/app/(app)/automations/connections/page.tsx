import type { Metadata } from "next";
import { ConnectionsView } from "@/features/automations/components/ConnectionsView";

export const metadata: Metadata = {
  title: "Connections - Actual Bench",
};

export default function AutomationConnectionsPage() {
  return <ConnectionsView />;
}
