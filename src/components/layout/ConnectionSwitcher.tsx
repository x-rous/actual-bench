"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Lock, Plus, Unplug, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getConnectionModeBadge } from "@/components/connect/utils";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import type { SavedBudget } from "@/features/connect/savedBudgets";
import type { ConnectionInstance, ConnectionMode } from "@/store/connection";
import { ConnectionHealthDot } from "./ConnectionHealthDot";

/**
 * The toolbar's budget switcher (PR-071b).
 *
 * One list of budgets, grouped by server, with the server's host and mode on
 * its header and one line per budget beneath: the ones connected this session
 * first (each with a green dot; the active one highlighted), then saved ones
 * not connected yet (no dot; most recently opened first). Every item keeps a fixed icon slot, so
 * labels line up. A filter box appears once there are enough budgets to need
 * one, and the list grows with the budgets up to the height of the window.
 *
 * Two tiers: the server header flush left, its budget names indented beneath.
 *
 * It only presents and reports choices; the toolbar owns what they do (the
 * unsaved-changes guard, connecting, disconnecting).
 */

const FILTER_FROM = 9;

/**
 * The disconnect items stay in the menu's muted text and turn red only when
 * pointed at or focused: a budget comes back from Saved in one click, so two
 * red lines on every open would warn louder than the actions deserve.
 */
const QUIET_DESTRUCTIVE = "gap-1 text-xs data-[variant=destructive]:text-muted-foreground";

function host(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function matches(filter: string, name: string, baseUrl: string): boolean {
  const needle = filter.trim().toLowerCase();
  return !needle || name.toLowerCase().includes(needle) || baseUrl.toLowerCase().includes(needle);
}

/** A fixed icon slot on every item, so all labels line up. */
function Slot({ children }: { children?: React.ReactNode }) {
  return <span className="flex w-5 shrink-0 items-center justify-center">{children}</span>;
}

/**
 * A server's header: its host, and whether Bench reaches it Direct or through
 * HTTP API. Flush left, so the budgets beneath it (behind their icon slot) read
 * as indented under it, with its pill on the same right edge as each row's ✕.
 */
function ServerHeader({ mode, baseUrl }: { mode: ConnectionMode; baseUrl: string }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1.5 pr-1.5 pb-0.5 pl-1.5 select-none" title={baseUrl}>
      <span className="truncate text-[11px] text-muted-foreground">{host(baseUrl)}</span>
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {getConnectionModeBadge(mode)}
      </span>
    </div>
  );
}

function NoMatch() {
  return <div className="py-1 pl-7.5 text-xs text-muted-foreground">No match.</div>;
}

/**
 * Items grouped by server - mode and address together, so a Direct server and
 * an HTTP API server never merge - in the order their first item appears.
 */
function byServer<T>(items: T[], serverOf: (item: T) => { mode: ConnectionMode; baseUrl: string }) {
  const groups = new Map<string, { mode: ConnectionMode; baseUrl: string; items: T[] }>();
  for (const item of items) {
    const { mode, baseUrl } = serverOf(item);
    const key = serverFingerprint({ mode, baseUrl });
    const group = groups.get(key) ?? { mode, baseUrl, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

type Row =
  | { kind: "connected"; instance: ConnectionInstance; mode: ConnectionMode; baseUrl: string }
  | { kind: "saved"; budget: SavedBudget; mode: ConnectionMode; baseUrl: string };

/** A budget connected this session: a green dot, the active one highlighted, and a ✕ to disconnect it. */
function ConnectedItem({
  instance,
  isActive,
  onSwitch,
  onDisconnect,
}: {
  instance: ConnectionInstance;
  isActive: boolean;
  onSwitch: (id: string) => void;
  onDisconnect: (id: string) => void;
}) {
  return (
    <DropdownMenuItem
      onClick={() => onSwitch(instance.id)}
      className={cn("group my-0.5 flex min-w-0 items-center gap-1 text-xs", isActive && "bg-accent/60 font-medium")}
      aria-current={isActive ? "true" : undefined}
      title={instance.baseUrl}
    >
      <Slot>
        <span className="size-1.5 rounded-full bg-emerald-500" aria-label="Connected" />
      </Slot>
      <span className="min-w-0 flex-1 truncate">{instance.label}</span>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus:opacity-100"
        aria-label={`Disconnect ${instance.label}`}
        title={`Disconnect ${instance.label}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDisconnect(instance.id);
        }}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </DropdownMenuItem>
  );
}

export function ConnectionSwitcher({
  active,
  instances,
  saved,
  locked,
  connectingTo,
  onSwitch,
  onOpenSaved,
  onUnlock,
  onAdd,
  onDisconnect,
  onDisconnectAll,
}: {
  active: ConnectionInstance;
  instances: ConnectionInstance[];
  saved: SavedBudget[];
  /** Saved connections are locked for this session. */
  locked: boolean;
  /** The saved budget being connected right now, shown in the button. */
  connectingTo: string | null;
  onSwitch: (id: string) => void;
  onOpenSaved: (saved: SavedBudget) => void;
  onUnlock: () => void;
  onAdd: () => void;
  /** Disconnect one budget; the active one goes through the toolbar's guard. */
  onDisconnect: (id: string) => void;
  onDisconnectAll: () => void;
}) {
  const [filter, setFilter] = useState("");
  const showFilter = instances.length + saved.length >= FILTER_FROM;
  const connected = instances.filter((instance) => matches(filter, instance.label, instance.baseUrl));
  const savedShown = saved.filter((budget) => matches(filter, budget.name, budget.baseUrl));
  // Connected rows first, so within each server they lead its saved ones.
  const rows: Row[] = [
    ...connected.map((instance) => ({ kind: "connected" as const, instance, mode: instance.mode, baseUrl: instance.baseUrl })),
    ...savedShown.map((budget) => ({ kind: "saved" as const, budget, mode: budget.mode, baseUrl: budget.baseUrl })),
  ];

  return (
    <DropdownMenu onOpenChange={(open) => !open && setFilter("")}>
      <DropdownMenuTrigger
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        title={`${active.label} - ${getConnectionModeBadge(active.mode)} · ${host(active.baseUrl)}`}
      >
        {connectingTo ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <ConnectionHealthDot />}
        <span className="max-w-56 truncate text-muted-foreground">
          {connectingTo ? `Connecting to ${connectingTo}...` : active.label}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[23rem] max-w-[calc(100vw-2rem)]">
        {showFilter && (
          <div className="p-1">
            <Input
              autoFocus
              value={filter}
              placeholder="Filter by budget or server"
              aria-label="Filter budgets"
              className="h-7 text-xs"
              onChange={(event) => setFilter(event.target.value)}
              // Keep typing in the box: the menu would otherwise take the keys
              // for its own type-to-select.
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        )}

        {/* Vertical scroll only: `overflow-y: auto` alone makes the other axis
            scrollable too, and a long name then showed a horizontal scrollbar
            instead of being cut short. Each section is its own box, so its
            pinned heading scrolls away with it rather than stacking under the
            next one. */}
        <div className="max-h-[min(40rem,calc(100dvh-14rem))] overflow-x-hidden overflow-y-auto">
          <section aria-label="Budgets">
            {locked && saved.length > 0 && (
              <DropdownMenuItem onClick={onUnlock} className="gap-1 text-xs">
                <Slot>
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                </Slot>
                Unlock saved connections...
              </DropdownMenuItem>
            )}
            <div className="space-y-1">
              {byServer(rows, (row) => row).map((group) => (
                <div key={group.key}>
                  <ServerHeader mode={group.mode} baseUrl={group.baseUrl} />
                  {group.items.map((row) =>
                    row.kind === "connected" ? (
                      <ConnectedItem
                        key={row.instance.id}
                        instance={row.instance}
                        isActive={row.instance.id === active.id}
                        onSwitch={onSwitch}
                        onDisconnect={onDisconnect}
                      />
                    ) : (
                      <DropdownMenuItem
                        key={`${row.budget.serverFingerprint}:${row.budget.budgetSyncId}`}
                        onClick={() => onOpenSaved(row.budget)}
                        className={cn("my-0.5 flex min-w-0 items-center gap-1 text-xs", locked && "opacity-60")}
                        title={row.budget.baseUrl}
                      >
                        <Slot />
                        <span className="min-w-0 flex-1 truncate">{row.budget.name}</span>
                      </DropdownMenuItem>
                    )
                  )}
                </div>
              ))}
            </div>
            {rows.length === 0 && <NoMatch />}
          </section>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onAdd} className="gap-1 text-xs">
          <Slot>
            <Plus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          </Slot>
          Add connection…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onDisconnect(active.id)} variant="destructive" className={QUIET_DESTRUCTIVE}>
          <Slot>
            <Unplug className="h-4 w-4" aria-hidden />
          </Slot>
          <span className="truncate">Disconnect {active.label}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDisconnectAll} variant="destructive" className={QUIET_DESTRUCTIVE}>
          <Slot>
            <Unplug className="h-4 w-4" aria-hidden />
          </Slot>
          Disconnect all
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
