import type { Metadata } from "next";
import { AppHealthView } from "@/features/app-diagnostics/components/AppHealthView";

export const metadata: Metadata = {
  title: "App Health - Actual Bench",
};

export default function AppHealthPage() {
  return <AppHealthView />;
}
