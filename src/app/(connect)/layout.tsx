import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect - Actual Bench",
};

/**
 * Centered layout for the connection screen. Uses a full-height scroll container
 * with a `my-auto` child so the form is vertically centered when it fits, but
 * top-aligns and scrolls when it's taller than the viewport (e.g. a server with
 * many budgets) — so the Connect button is always reachable.
 */
export default function ConnectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-muted/30 p-4">
      <div className="my-auto flex w-full justify-center">
        {children}
      </div>
    </div>
  );
}
