import type { Metadata } from "next";
import { CategoriesView } from "@/features/categories/components/CategoriesView";

export const metadata: Metadata = {
  title: "Categories — Actual Bench",
};

export default function CategoriesPage() {
  return <CategoriesView />;
}
