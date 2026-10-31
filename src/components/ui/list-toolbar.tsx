import type { ReactNode } from "react";

export function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-4 py-2">
      {children}
    </div>
  );
}
