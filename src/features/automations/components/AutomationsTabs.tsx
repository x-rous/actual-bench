"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The three faces of Automations (RD-079).
 *
 * What runs, what happened, and what Bench is allowed to act on. Route-backed
 * rather than local state, so each is linkable - the backup rules page points
 * straight at one automation's runs, and a bookmark to "what failed" survives a
 * reload.
 */

const TABS = [
  { href: "/automations", label: "Automations" },
  { href: "/automations/runs", label: "Run history" },
  { href: "/automations/connections", label: "Connections" },
];

export function AutomationsTabs() {
  const pathname = usePathname();

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
