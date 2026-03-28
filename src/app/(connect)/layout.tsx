import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect — Actual Bench",
};

/** Minimal centered layout for the connection screen. */
export default function ConnectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      {children}
    </div>
  );
}
