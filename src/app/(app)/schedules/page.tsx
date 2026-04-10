import type { Metadata } from "next";
import { SchedulesView } from "@/features/schedules/components/SchedulesView";

export const metadata: Metadata = {
  title: "Schedules — Actual Bench",
};

export default function SchedulesPage() {
  return <SchedulesView />;
}
