import type { Metadata } from "next";
import { ConnectForm } from "@/components/connect/ConnectForm";

export const metadata: Metadata = {
  title: "Connect — Actual Bench",
};

export default function ConnectPage() {
  return <ConnectForm />;
}
