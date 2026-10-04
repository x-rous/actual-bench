"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The Assets & Debt sections (RD-084 P1.3; FR-195, FR-206). Route-backed
 * links so each is linkable, in the same underline style as the other tabbed
 * workspaces. Tab moves through them in order; the arrow keys, Home and End
 * move between them too.
 */

export const ASSETS_DEBT_TABS = [
  { href: "/assets-debt", label: "Overview", exact: true },
  { href: "/assets-debt/loans", label: "Loans & Debt" },
  { href: "/assets-debt/assets", label: "Assets" },
  { href: "/assets-debt/activity", label: "Activity" },
];

const TAB_CLASS =
  "flex flex-1 items-center justify-center gap-1 rounded-none border-b-2 border-transparent bg-transparent px-2 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex-none lg:px-6";

export function AssetsDebtTabs() {
  const pathname = usePathname() ?? "";
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const move = (from: number, key: string) => {
    const last = ASSETS_DEBT_TABS.length - 1;
    const to = key === "ArrowRight" ? (from === last ? 0 : from + 1) : key === "ArrowLeft" ? (from === 0 ? last : from - 1) : key === "Home" ? 0 : key === "End" ? last : null;
    if (to === null) return false;
    refs.current[to]?.focus();
    return true;
  };
  return (
    <nav aria-label="Assets & Debt sections" className="flex shrink-0 items-center border-b border-border">
      {ASSETS_DEBT_TABS.map((tab, i) => {
        const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            ref={(el) => {
              refs.current[i] = el;
            }}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(TAB_CLASS, active && "border-primary text-foreground")}
            onKeyDown={(e) => {
              if (move(i, e.key)) e.preventDefault();
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
