import type { Metadata } from "next";
import { BrowserApiLabClient } from "./BrowserApiLabClient";

export const dynamic = "force-dynamic";


function isDirectBrowserApiDisabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off";
}

export const metadata: Metadata = {
  title: "Browser API Lab - Actual Bench",
};

export default function BrowserApiLabPage() {
  const enabled =
    !isDirectBrowserApiDisabled(process.env["DIRECT_BROWSER_API"]) &&
    !isDirectBrowserApiDisabled(process.env["NEXT_PUBLIC_DIRECT_BROWSER_API"]);

  return <BrowserApiLabClient enabled={enabled} />;
}
