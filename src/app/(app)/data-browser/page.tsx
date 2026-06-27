import type { Metadata } from "next";
import { DataBrowserClient } from "./DataBrowserClient";

export const metadata: Metadata = {
  title: "Data Browser - Actual Bench",
};

export default function DataBrowserPage() {
  return <DataBrowserClient />;
}
