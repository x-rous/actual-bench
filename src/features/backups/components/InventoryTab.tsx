"use client";

import Link from "next/link";
import { FileText, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BackupsTable } from "./BackupsTable";
import { ReadinessBanner } from "./ReadinessBanner";
import { formatBytes } from "../lib/presentation";
import type { ArtifactWithLocations, RecoveryCenterData } from "../lib/backupsApi";

/**
 * The copies that exist (RD-077 / PR-047).
 *
 * The operational half: what Bench would actually give you back, how old it is,
 * whether it has been opened and read, and where it lives. Everything that
 * decides what happens next is in Setup; this tab is the evidence.
 *
 * When there is nothing here yet it explains the order things have to happen in
 * and sends people to Setup, rather than showing an empty table and leaving
 * them to work out which of the two tabs to start on.
 */

export type StateFilter = "all" | "verified" | "unverified" | "problem";
export type KindFilter = "all" | "budget" | "app-db";

type Props = {
  data: RecoveryCenterData;
  verifying: boolean;
  onVerify: () => void;
  artifacts: ArtifactWithLocations[];
  filtered: ArtifactWithLocations[];
  stateFilter: StateFilter;
  kindFilter: KindFilter;
  selectedArtifactId: string | null;
  needsDestination: boolean;
  needsRule: boolean;
  onStateFilter: (value: StateFilter) => void;
  onKindFilter: (value: KindFilter) => void;
  onOpenArtifact: (artifactId: string) => void;
  onGoToSetup: () => void;
};

export function InventoryTab({
  data,
  verifying,
  onVerify,
  artifacts,
  filtered,
  stateFilter,
  kindFilter,
  selectedArtifactId,
  needsDestination,
  needsRule,
  onStateFilter,
  onKindFilter,
  onOpenArtifact,
  onGoToSetup,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ReadinessBanner readiness={data.readiness} />

      {artifacts.length === 0 ? (
        <div className="mx-auto max-w-xl px-6 py-12">
          <h2 className="text-sm font-semibold">
            {needsDestination
              ? "Start by choosing where copies go"
              : needsRule
                ? "Now say what to copy, and how often"
                : "No copies yet"}
          </h2>
          <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li className={cn("flex gap-2", !needsDestination && "text-foreground/60 line-through")}>
              <span aria-hidden>1.</span>
              <span>
                Add a <strong className="font-medium">destination</strong> - a folder on this server,
                or an S3-compatible bucket. Two of them, if you want to survive losing the machine.
              </span>
            </li>
            <li
              className={cn(
                "flex gap-2",
                !needsRule && !needsDestination && "text-foreground/60 line-through"
              )}
            >
              <span aria-hidden>2.</span>
              <span>
                Add a <strong className="font-medium">backup rule</strong>: what to copy, where, and
                when.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>3.</span>
              <span>
                Bench takes the copy, opens it to check it is readable, and lists it here with what it
                found inside.
              </span>
            </li>
          </ol>

          {/* The prerequisite that is invisible until it bites: a scheduled
              backup runs with the browser closed, so it needs credentials the
              server can use on its own. */}
          {!needsDestination && data.sources.length === 0 && (
            <p className="mt-4 rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              To back up a budget on a schedule, Bench needs a connection enrolled for unattended use
              - a scheduled backup runs with no browser open.{" "}
              <Link href="/sync" className="underline underline-offset-4">
                Enrol one in Budget File Sync
              </Link>
              . Without that you can still back up Bench&rsquo;s own settings.
            </p>
          )}

          {(needsDestination || needsRule) && (
            <Button size="sm" className="mt-4" onClick={onGoToSetup}>
              Go to Setup
            </Button>
          )}

          {!needsDestination && !needsRule && (
            <p className="mt-4 text-xs text-muted-foreground">
              Already have Bench backups in a destination? Use{" "}
              <strong className="font-medium">Find backups</strong> in Setup to read them back into
              the inventory.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-1.5 text-xs">
            {/* The count that used to sit in the page header, now beside the
                filters that change it. */}
            <span className="font-medium">
              {filtered.length === artifacts.length
                ? `${artifacts.length} ${artifacts.length === 1 ? "copy" : "copies"}`
                : `${filtered.length} of ${artifacts.length}`}
              <span className="font-normal text-muted-foreground">
                , {formatBytes(filtered.reduce((total, entry) => total + entry.sizeBytes, 0))}
              </span>
            </span>
            <span className="text-muted-foreground">|</span>

            <select
              className="h-6 rounded-md border border-input bg-background px-1.5 text-xs"
              value={stateFilter}
              onChange={(event) => onStateFilter(event.target.value as StateFilter)}
              aria-label="Filter by state"
            >
              <option value="all">Any state</option>
              <option value="verified">Verified</option>
              <option value="unverified">Not checked</option>
              <option value="problem">Damaged or missing</option>
            </select>

            <select
              className="h-6 rounded-md border border-input bg-background px-1.5 text-xs"
              value={kindFilter}
              onChange={(event) => onKindFilter(event.target.value as KindFilter)}
              aria-label="Filter by contents"
            >
              <option value="all">Anything</option>
              <option value="budget">Budgets</option>
              <option value="app-db">Bench settings</option>
            </select>

            <span
              className="text-muted-foreground"
              title="Retention never removes a pinned copy, anything under the minimum age, or the newest verified copy. Backups you take by hand are kept until you delete them."
            >
              Pinned and newest-verified copies are never deleted
            </span>

            <span className="flex-1" />

            {/* The actions that act on this inventory, beside it rather than in
                a page header shared with Setup. */}
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={onVerify}
              disabled={verifying || artifacts.length === 0}
              title="Re-read the newest copies in every destination: are they present, the right size, and still readable?"
            >
              {verifying ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <ShieldCheck aria-hidden />
              )}
              Verify now
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => window.open("/api/backups/recovery-sheet", "_blank")}
              title="Download a printable page telling you how to restore these backups without Bench - paths, object keys, checksums and commands"
            >
              <FileText aria-hidden />
              Recovery sheet
            </Button>
          </div>

          <BackupsTable
            artifacts={filtered}
            policies={data.policies}
            selectedId={selectedArtifactId}
            onOpen={onOpenArtifact}
          />
        </>
      )}
    </div>
  );
}
