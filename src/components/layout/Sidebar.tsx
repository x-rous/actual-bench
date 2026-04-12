"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Landmark,
  Users,
  LayoutList,
  ScrollText,
  Calendar,
  Tag,
  Terminal,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
  HelpCircle,
  ExternalLink,
  AlertCircle,
  BookOpen,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/store/connection";
import { useSavedServersStore } from "@/store/savedServers";
import { useStagedStore } from "@/store/staged";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const GITHUB_URL = "https://github.com/x-rous/actual-bench";

const LS_KEY = "sidebar-collapsed";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/overview", icon: LayoutDashboard },
  { label: "Rules", href: "/rules", icon: ScrollText },
  { label: "Accounts", href: "/accounts", icon: Landmark },
  { label: "Payees", href: "/payees", icon: Users },
  { label: "Categories", href: "/categories", icon: LayoutList },
  { label: "Schedules", href: "/schedules", icon: Calendar },
  { label: "Tags", href: "/tags", icon: Tag },
  { label: "ActualQL", href: "/query", icon: Terminal, badge: "dev" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const clearAll = useConnectionStore((s) => s.clearAll);
  const clearServers = useSavedServersStore((s) => s.clearServers);
  const discardAll = useStagedStore((s) => s.discardAll);
  const version = process.env.NEXT_PUBLIC_APP_VERSION;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(LS_KEY) === "1";
  });

  function handleClearAll() {
    if (!window.confirm("Clear all connections and cached data? This cannot be undone.")) return;
    discardAll();
    queryClient.clear();
    clearAll();
    clearServers();
    router.push("/connect");
  }

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(LS_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200",
        collapsed ? "w-12" : "w-52"
      )}
    >
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 pt-3">
        {NAV_ITEMS.map(({ label, href, icon: Icon, badge }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center rounded-md px-2 py-2 text-sm font-medium transition-colors",
                collapsed ? "justify-center" : "gap-2.5 px-3",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  {label}
                  {badge && (
                    <span className="ml-auto rounded-sm bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground/60">
                      {badge}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
        {!collapsed && version && (
          <span className="px-3 pt-2 text-xs text-muted-foreground/60">
            v{version}
          </span>
        )}
      </nav>

      {/* Bottom actions */}
      <div className="shrink-0 border-t border-border p-2 flex flex-col gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            title="Help & feedback"
            className={cn(
              "flex w-full items-center rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground",
              collapsed ? "justify-center" : "gap-2"
            )}
          >
            <HelpCircle className="h-4 w-4 shrink-0 text-xs text-muted-foreground" />
            {!collapsed && <span>Help & feedback</span>}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-52 text-xs text-muted-foreground">
            <DropdownMenuItem onClick={() => window.open(GITHUB_URL, "_blank", "noopener,noreferrer")}>
              <ExternalLink className="h-4 w-4 text-xs text-muted-foreground"  />
              GitHub Repository
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open(`${GITHUB_URL}/issues/new`, "_blank", "noopener,noreferrer")}>
              <AlertCircle className="h-4 w-4 text-xs text-muted-foreground" />
              Report an Issue
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => window.open(`${GITHUB_URL}/blob/main/CHANGELOG.md`, "_blank", "noopener,noreferrer")}>
              <BookOpen className="h-4 w-4 text-xs text-muted-foreground" />
              Changelog
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={handleClearAll}
          title="Clear all connections and cached data"
          className={cn(
            "flex w-full items-center rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
            collapsed ? "justify-center" : "gap-2"
          )}
        >
          <Trash2 className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Clear all data</span>}
        </button>
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex w-full items-center rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground",
            collapsed ? "justify-center" : "gap-2"
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4 shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
