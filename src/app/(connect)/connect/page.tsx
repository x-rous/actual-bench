import type { Metadata } from "next";
import { ConnectForm } from "@/components/connect/ConnectForm";
import { DemoButton } from "@/components/connect/DemoButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect - Actual Bench",
};

function isDemoConfigured() {
  const { DEMO_MODE, DEMO_BASE_URL, DEMO_API_KEY, DEMO_BUDGET_SYNC_ID } =
    process.env;
  return (
    DEMO_MODE === "1" &&
    Boolean(DEMO_BASE_URL) &&
    Boolean(DEMO_API_KEY) &&
    Boolean(DEMO_BUDGET_SYNC_ID)
  );
}

export default function ConnectPage() {
  return (
    <div className="w-full flex flex-col items-center gap-4">
      {isDemoConfigured() && <DemoButton />}
      <ConnectForm />
    </div>
  );
}
