import type { Metadata } from "next";
import { ConnectForm } from "@/components/connect/ConnectForm";
import { DemoButton } from "@/components/connect/DemoButton";

export const metadata: Metadata = {
  title: "Connect - Actual Bench",
};

export default function ConnectPage() {
  return (
    <div className="w-full flex flex-col items-center gap-4">
      <DemoButton />
      <ConnectForm />
    </div>
  );
}
