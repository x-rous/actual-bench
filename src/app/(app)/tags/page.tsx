import type { Metadata } from "next";
import { TagsView } from "@/features/tags/components/TagsView";

export const metadata: Metadata = {
  title: "Tags — Actual Bench",
};

export default function TagsPage() {
  return <TagsView />;
}
