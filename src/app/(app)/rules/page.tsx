import type { Metadata } from "next";
import { RulesView } from "@/features/rules/components/RulesView";

export const metadata: Metadata = {
  title: "Rules — Actual Bench",
};

export default function RulesPage() {
  return <RulesView />;
}
