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

/**
 * The same shape Budget File Health uses for its workbench tabs: an underline
 * under the selected one. Copied deliberately - two tabbed pages in one app
 * should not look like two different ideas.
 */
const TAB_CLASS =
  "flex flex-1 items-center justify-center gap-1 rounded-none border-b-2 border-transparent bg-transparent px-2 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground lg:flex-none lg:px-6";

export function AutomationsTabs() {
  const pathname = usePathname();

  return (
    <div className="flex shrink-0 items-center border-b border-border">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(TAB_CLASS, active && "border-primary text-foreground")}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
