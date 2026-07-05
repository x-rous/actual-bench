import type { Metadata } from "next";
import { isDirectBrowserApiEnabled } from "@/lib/directMode";
import { BrowserApiLabClient } from "./BrowserApiLabClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Browser API Lab - Actual Bench",
};

export default function BrowserApiLabPage() {
  return <BrowserApiLabClient enabled={isDirectBrowserApiEnabled()} />;
}
