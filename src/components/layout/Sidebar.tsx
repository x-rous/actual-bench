"use client";

import { useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PanelLeftClose, PanelLeftOpen, LayoutDashboard,
  ArrowUpCircle, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useVersionCheckContext } from "@/hooks/useVersionCheck";

import { OverlayScrollArea } from "@/features/budget-management/components/OverlayScrollArea";

import { FEATURE_SECTIONS, getFeatureForPath } from "@/lib/features/catalogue";

const LS_KEY = "sidebar-collapsed";

type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

type SidebarSection =
  | { type: "item"; item: NavItem }
  | { type: "group"; group: NavGroup };

/** Overview is an application page; feature destinations come from the catalogue. */
export const SIDEBAR_SECTIONS: SidebarSection[] = [
  { type: "item", item: { id: "overview", label: "Overview", href: "/overview", icon: LayoutDashboard } },
  ...FEATURE_SECTIONS.map((group): SidebarSection => ({ type: "group", group })),
];

// App Health is app-wide (not a budget tool), so it lives in the footer rather
// than a feature group.
const APP_HEALTH_ITEM: NavItem = { id: "app-health", label: "App Health", href: "/app-health", icon: Settings };

type SidebarNavLinkProps = {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
};

function SidebarNavLink({ item, collapsed, pathname }: SidebarNavLinkProps) {
  const isExactMatch = pathname === item.href;
  const feature = getFeatureForPath(pathname);
  const isAncestorMatch = !isExactMatch && feature?.href === item.href;
  const active = isExactMatch || isAncestorMatch;
  const ariaCurrent = isExactMatch ? "page" : isAncestorMatch ? "location" : undefined;
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      data-active={active ? "true" : undefined}
      aria-current={ariaCurrent}
      className={cn(
        // Feature groups keep growing, but a nav that is shorter and harder
        // to read is not a win: the type size and horizontal padding stay, and
        // the rows keep enough vertical room to be distinguishable at a glance.
        // 5px rather than 6px trims 2px a row - enough to matter down a long
        // list, not enough to crowd the 20px line box.
        "flex items-center rounded-md px-2 py-[5px] text-[13.3px] font-medium transition-colors",
        collapsed ? "justify-center py-[5px]" : "gap-2.5 px-3",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  const { updateAvailable, latestVersion } = useVersionCheckContext();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(LS_KEY) === "1";
  });


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
      <OverlayScrollArea className="flex-1">
        <nav className="flex min-h-full flex-col p-2 pt-3">
          {SIDEBAR_SECTIONS.map((section, index) => {
            const sectionSpacing = index === 0 ? "" : collapsed ? "mt-3" : "mt-4";

            if (section.type === "item") {
              return (
                <div key={section.item.id} className={sectionSpacing}>
                  <SidebarNavLink
                    item={section.item}
                    collapsed={collapsed}
                    pathname={pathname}
                  />
                </div>
              );
            }

            const groupClassName = sectionSpacing;

            return (
              <div key={section.group.id} className={groupClassName}>
                {!collapsed && (
                  <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                    {section.group.label}
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  {section.group.items.map((item) => (
                    <SidebarNavLink
                      key={item.id}
                      item={item}
                      collapsed={collapsed}
                      pathname={pathname}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {!collapsed && updateAvailable && latestVersion && (
            <div className="mt-auto flex flex-col gap-0.5 px-3 pt-3">
              <a
                href="https://github.com/x-rous/actual-bench/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <ArrowUpCircle className="h-3 w-3 shrink-0" />
                v{latestVersion} available
              </a>
            </div>
          )}
        </nav>
      </OverlayScrollArea>

      <div className="shrink-0 border-t border-border p-2 flex flex-col gap-0.5">
        <Link
          href={APP_HEALTH_ITEM.href}
          title={collapsed ? APP_HEALTH_ITEM.label : undefined}
          aria-label={collapsed ? APP_HEALTH_ITEM.label : undefined}
          aria-current={pathname === APP_HEALTH_ITEM.href ? "page" : undefined}
          className={cn(
            "flex w-full items-center rounded-md px-2 py-1.5 text-xs transition-colors",
            collapsed ? "justify-center" : "gap-2",
            pathname === APP_HEALTH_ITEM.href
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
          )}
        >
          <APP_HEALTH_ITEM.icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{APP_HEALTH_ITEM.label}</span>}
          {!collapsed && version && (
            <span className="ml-auto text-xs text-muted-foreground/55">v{version}</span>
          )}
        </Link>

        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
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
