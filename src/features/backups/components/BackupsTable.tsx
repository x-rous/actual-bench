"use client";

import { CircleCheck, CircleHelp, CircleX, Lock, Pin, Server } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COPY_STATE_COPY,
  copyState,
  formatBytes,
  formatDateTime,
  relativeTime,
  type CopyState,
} from "../lib/presentation";
import type { ArtifactWithLocations } from "../lib/backupsApi";

/**
 * The inventory (RD-077 / PR-047e).
 *
 * One line per backup, because the task is scanning: *which copy do I want, and
 * can I trust it?* The columns are chosen to answer exactly that and nothing
 * else — when it was taken, what it holds, whether Bench has read it, and where
 * it lives. Everything further is in the side sheet.
 *
 * The same layout rules as the Automations table: space in proportion to
 * trouble (a healthy copy gets one line; a damaged one gets a second carrying
 * the reason), and status carried by word, shape and colour together so it
 * survives a screenshot and a colour-blind reader.
 */

const STATE_STYLE: Record<CopyState, { icon: LucideIcon; tone: string; row?: string }> = {
  verified: { icon: CircleCheck, tone: "text-green-600 dark:text-green-500" },
  unverified: { icon: CircleHelp, tone: "text-muted-foreground" },
  damaged: { icon: CircleX, tone: "text-destructive", row: "bg-destructive/5" },
  gone: { icon: CircleX, tone: "text-destructive", row: "bg-destructive/5" },
};

type Props = {
  artifacts: ArtifactWithLocations[];
  selectedId: string | null;
  onOpen: (artifactId: string) => void;
};

export function BackupsTable({ artifacts, selectedId, onOpen }: Props) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-2 font-medium">Taken</th>
            <th scope="col" className="px-4 py-2 font-medium">Contents</th>
            <th scope="col" className="px-4 py-2 font-medium">State</th>
            <th scope="col" className="px-4 py-2 font-medium">Size</th>
            <th scope="col" className="px-4 py-2 font-medium">Stored in</th>
            <th scope="col" className="px-4 py-2 font-medium">Keep</th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((artifact) => {
            const state = copyState(artifact);
            const style = STATE_STYLE[state];
            const Icon = style.icon;
            const stored = artifact.locations.filter((location) => location.status === "stored");
            const troubled = state === "damaged" || state === "gone";

            return (
              <tr
                key={artifact.id}
                onClick={() => onOpen(artifact.id)}
                className={cn(
                  "cursor-pointer border-b border-border/60 align-top hover:bg-muted/50",
                  style.row,
                  selectedId === artifact.id && "bg-muted"
                )}
              >
                <td className="px-4 py-2 whitespace-nowrap">
                  {/* A real button, not a clickable row: everything a backup
                      can do - look inside, download, pin, delete - lives behind
                      opening it, so a mouse-only row would put the whole
                      feature out of reach for anyone not using one. The row
                      stays clickable as a convenience on top. */}
                  <button
                    type="button"
                    className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(artifact.id);
                    }}
                  >
                    {relativeTime(artifact.createdAt)}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(artifact.createdAt)}
                  </div>
                </td>

                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    {artifact.kind === "app-db" ? (
                      <Server className="size-3.5 text-muted-foreground" aria-hidden />
                    ) : null}
                    <span>
                      {artifact.kind === "budget"
                        ? artifact.sourceBudgetName ?? "Budget"
                        : "Bench settings"}
                    </span>
                    {artifact.encrypted && (
                      <Lock className="size-3.5 text-muted-foreground" aria-label="Encrypted" />
                    )}
                  </div>
                  {artifact.takenBefore && (
                    <div className="text-xs text-muted-foreground">
                      Taken before {artifact.takenBefore}
                    </div>
                  )}
                </td>

                <td className="px-4 py-2">
                  <div className={cn("flex items-center gap-1.5 whitespace-nowrap", style.tone)}>
                    <Icon className="size-4" aria-hidden />
                    <span className="font-medium">{COPY_STATE_COPY[state].label}</span>
                  </div>
                  {troubled && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {COPY_STATE_COPY[state].detail}
                    </div>
                  )}
                </td>

                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                  {formatBytes(artifact.sizeBytes)}
                </td>

                <td className="px-4 py-2">
                  {stored.length === 0 ? (
                    <span className="text-muted-foreground">nowhere</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {stored.map((location) => (
                        <span
                          key={location.id}
                          className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {location.destinationName ?? "removed destination"}
                        </span>
                      ))}
                    </div>
                  )}
                </td>

                <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">
                  {artifact.pinned ? (
                    <span className="flex items-center gap-1 text-foreground">
                      <Pin className="size-3.5" aria-hidden /> Pinned
                    </span>
                  ) : artifact.protectedUntil && new Date(artifact.protectedUntil) > new Date() ? (
                    `Protected until ${artifact.protectedUntil.slice(0, 10)}`
                  ) : (
                    tierLabel(artifact.tier)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function tierLabel(tier: string): string {
  switch (tier) {
    case "manual":
      return "Kept (taken by hand)";
    case "auto":
      return "Recovery point";
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "yearly":
      return "Yearly";
    default:
      return tier;
  }
}
