"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BackupsTable, type BackupSortKey } from "./BackupsTable";
import { ReadinessBanner } from "./ReadinessBanner";
import { budgetsInArtifacts, formatBytes } from "../lib/presentation";
import type { SortDirection } from "@/components/ui/sortable-header";
import type { ArtifactWithLocations, RecoveryCenterData } from "../lib/backupsApi";
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";

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

export type StateFilter = "all" | "verified" | "unverified" | "review" | "problem";
export type KindFilter = "all" | "budget" | "app-db";

type Props = {
  data: RecoveryCenterData;
  verifying: boolean;
  onVerify: () => void;
  artifacts: ArtifactWithLocations[];
  filtered: ArtifactWithLocations[];
  search: string;
  stateFilter: StateFilter;
  kindFilter: KindFilter;
  budget: string;
  policyId: string;
  sort: { key: BackupSortKey; direction: SortDirection } | null;
  selectedArtifactId: string | null;
  needsDestination: boolean;
  needsRule: boolean;
  onSearch: (value: string) => void;
  onStateFilter: (value: StateFilter) => void;
  onKindFilter: (value: KindFilter) => void;
  onBudget: (value: string) => void;
  onPolicy: (value: string) => void;
  onSort: (key: BackupSortKey, direction: SortDirection) => void;
  onClearFilters: () => void;
  onOpenArtifact: (artifactId: string) => void;
  onGoToSetup: () => void;
  /** Ticked rows, for a bulk action. */
  checked: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
  onBulkPin: (ids: string[], pinned: boolean) => void;
  onBulkDelete: (ids: string[]) => void;
  bulkPending: boolean;
};

/** Rows shown at a time; more on request. */
const PAGE_SIZE = 200;

export function InventoryTab({
  data,
  verifying,
  onVerify,
  artifacts,
  filtered,
  search,
  stateFilter,
  kindFilter,
  budget,
  policyId,
  sort,
  selectedArtifactId,
  needsDestination,
  needsRule,
  onSearch,
  onStateFilter,
  onKindFilter,
  onBudget,
  onPolicy,
  onSort,
  onClearFilters,
  onOpenArtifact,
  onGoToSetup,
  checked,
  onCheckedChange,
  onBulkPin,
  onBulkDelete,
  bulkPending,
}: Props) {
  // Every copy is loaded; the table shows them a page at a time so a long
  // history stays quick to render, with the count saying how many there are.
  const [visible, setVisible] = useState(PAGE_SIZE);
  const shown = filtered.slice(0, visible);
  // Only ticked rows that are still in the filtered set count, so a bulk
  // action never reaches a copy the user can no longer see.
  const filteredIds = new Set(filtered.map((artifact) => artifact.id));
  const selectedIds = [...checked].filter((id) => filteredIds.has(id));
  const budgets = budgetsInArtifacts(artifacts);
  const filtering =
    search.trim() !== "" ||
    stateFilter !== "all" ||
    kindFilter !== "all" ||
    budget !== "" ||
    policyId !== "";

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
                Enrol one in Cross Budget Sync
              </Link>
              . Without that you can still back up Actual Bench&rsquo;s own data.
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
            {/* Search first, because with a few hundred copies the fastest way
                to the one you mean is to type part of what you remember - a
                budget name, a rule, or the destination it went to. */}
            <SearchInput
              value={search}
              onValueChange={onSearch}
              placeholder="Search copies…"
              aria-label="Search backups"
            />

            <Select
              className="h-6 w-auto"
              value={stateFilter}
              onValueChange={(value) => onStateFilter(value as StateFilter)}
              aria-label="Filter by state"
              options={[
                { value: "all", label: "Any state" },
                { value: "verified", label: "Verified" },
                { value: "unverified", label: "Not checked" },
                { value: "review", label: "Needs review" },
                { value: "problem", label: "Any problem" },
              ]}
            />

            <Select
              className="h-6 w-auto"
              value={kindFilter}
              onValueChange={(value) => onKindFilter(value as KindFilter)}
              aria-label="Filter by contents"
              options={[
                { value: "all", label: "Anything" },
                { value: "budget", label: "Budgets" },
                { value: "app-db", label: "Bench data" },
              ]}
            />

            {/* Only offered when there is more than one: a picker with one
                option is a question with one answer. */}
            {budgets.length > 1 && (
              <Select
                className="h-6 w-auto"
                value={budget}
                onValueChange={onBudget}
                aria-label="Filter by budget"
                options={[{ value: "", label: "Any budget" }, ...budgets.map((name) => ({ value: name, label: name }))]}
              />
            )}

            {data.policies.length > 1 && (
              <Select
                className="h-6 w-auto"
                value={policyId}
                onValueChange={onPolicy}
                aria-label="Filter by rule"
                options={[{ value: "", label: "Any rule" }, ...data.policies.map((policy) => ({ value: policy.id, label: policy.name }))]}
              />
            )}

            {/* One statement about how many, the cap included. Saying "200"
                and then "newest 200 shown" beside it is the same fact twice. */}
            <span className="font-medium">
              {filtering ? `${filtered.length} of ` : ""}
              {artifacts.length >= 200 ? `newest ${artifacts.length}` : artifacts.length}
              <span className="font-normal text-muted-foreground">
                {" "}
                {artifacts.length === 1 ? "copy" : "copies"},{" "}
                {formatBytes(filtered.reduce((total, entry) => total + entry.sizeBytes, 0))}
              </span>
            </span>

            {filtering && (
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={onClearFilters}
              >
                Clear
              </button>
            )}

            <span className="flex-1" />
            <span
              className="text-muted-foreground"
              title="Retention never removes a pinned copy, anything under the minimum age, or the newest verified copy. Backups you take by hand are kept until you delete them."
            >
              Pinned and newest-verified copies are never deleted
            </span>

            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={onVerify}
              disabled={verifying || artifacts.length === 0}
              title="Open the newest copy of each rule to confirm it is still readable, and checksum the copies checked longest ago, in every destination"
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

          {selectedIds.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-1.5 text-xs"
              role="region"
              aria-label="Bulk actions"
            >
              <span className="font-medium">
                {selectedIds.length} of {filtered.length} {filtered.length === 1 ? "copy" : "copies"} selected
              </span>
              <Button size="sm" variant="outline" className="h-6 text-xs" disabled={bulkPending} onClick={() => onBulkPin(selectedIds, true)}>
                Pin
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-xs" disabled={bulkPending} onClick={() => onBulkPin(selectedIds, false)}>
                Unpin
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs text-destructive"
                disabled={bulkPending}
                onClick={() => onBulkDelete(selectedIds)}
              >
                Delete…
              </Button>
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => onCheckedChange(new Set())}
              >
                Clear selection
              </button>
              {bulkPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Working" />}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <p>No results match your filters.</p>
              <button type="button" className="mt-1 underline-offset-4 hover:underline" onClick={onClearFilters}>
                Clear filters
              </button>
            </div>
          ) : (
          <>
          <BackupsTable
            artifacts={shown}
            policies={data.policies}
            selectedId={selectedArtifactId}
            sort={sort}
            onSort={onSort}
            onOpen={onOpenArtifact}
            checked={checked}
            onCheck={(id, value) => {
              const next = new Set(checked);
              if (value) next.add(id);
              else next.delete(id);
              onCheckedChange(next);
            }}
            onCheckAll={(value) => {
              const next = new Set(checked);
              for (const artifact of shown) {
                if (value) next.add(artifact.id);
                else next.delete(artifact.id);
              }
              onCheckedChange(next);
            }}
          />
          <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-xs text-muted-foreground">
            <span>
              Showing {shown.length} of {filtered.length}
              {filtered.length !== artifacts.length ? ` matching (${artifacts.length} in total)` : ""}
            </span>
            {shown.length < filtered.length && (
              <button
                type="button"
                className="text-foreground underline-offset-4 hover:underline"
                onClick={() => setVisible((current) => current + PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
              </button>
            )}
          </div>
          </>
          )}
        </>
      )}
    </div>
  );
}
