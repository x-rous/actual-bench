import type { Metadata } from "next";
import { BrowserApiLabClient } from "./BrowserApiLabClient";

export const metadata: Metadata = {
  title: "Browser API Lab - Actual Bench",
};

export default function BrowserApiLabPage() {
  const enabled = process.env.NEXT_PUBLIC_DIRECT_BROWSER_API === "1";

  return <BrowserApiLabClient enabled={enabled} />;
}
