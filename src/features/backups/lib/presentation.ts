import { compareValues, type SortDirection } from "@/components/ui/sortable-header";
import { describeCronExpression } from "@/lib/automation/cron";
import type { BackupSortKey } from "../components/BackupsTable";
import type { ArtifactWithLocations } from "./backupsApi";
import type { BackupPolicy } from "@/lib/app-db/backupRepository";

/**
 * Turning backup state into words (RD-077 / PR-047e).
 *
 * Kept out of the components because these are judgements, not formatting:
 * whether a copy counts as verified, what a retention rule adds up to in plain
 * English, how old is too old. Two implementations of any of those would
 * eventually disagree with each other on the same screen.
 */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "3h ago" and "in 3h", from the same function.
 *
 * Both directions matter here: this page shows when a copy was taken *and* when
 * the next one is due. Formatting only the past meant every future time came
 * back as "just now" - a schedule set for 20:00 read as though it were running
 * as you looked at it.
 */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";

  const minutes = Math.round((now.getTime() - then) / 60_000);
  const future = minutes < 0;
  const magnitude = Math.abs(minutes);
  const scale = (value: number, unit: string) => (future ? `in ${value}${unit}` : `${value}${unit} ago`);

  if (magnitude < 1) return "just now";
  if (magnitude < 60) return scale(magnitude, "m");
  const hours = Math.round(magnitude / 60);
  if (hours < 24) return scale(hours, "h");
  const days = Math.round(hours / 24);
  if (days < 30) return scale(days, "d");
  const months = Math.round(days / 30);
  return months < 12 ? scale(months, "mo") : scale(Math.round(months / 12), "y");
}

export type CopyState = "verified" | "unverified" | "damaged" | "gone";

/**
 * What a copy is worth, in one word.
 *
 * "Gone" outranks everything: a backup with no surviving copy is not a backup
 * whatever its verification once said, and showing it as verified would be the
 * single most misleading thing this page could do.
 */
export function copyState(artifact: ArtifactWithLocations): CopyState {
  const stored = artifact.locations.filter((location) => location.status === "stored");
  if (stored.length === 0) return "gone";
  if (artifact.verificationStatus === "failed") return "damaged";
  if (artifact.verificationStatus === "passed") return "verified";
  return "unverified";
}

export const COPY_STATE_COPY: Record<CopyState, { label: string; detail: string }> = {
  verified: { label: "Verified", detail: "Bench opened this copy and read it." },
  unverified: {
    label: "Not checked",
    detail: "Stored, but Bench has not opened it. It might restore and it might not.",
  },
  damaged: {
    label: "Damaged",
    detail: "Bench could not read this copy. Do not rely on it.",
  },
  gone: {
    label: "No copy",
    detail: "Bench has a record of this backup but no surviving copy of it.",
  },
};

export function describeRetention(policy: BackupPolicy): string {
  const { retention } = policy;
  const parts: string[] = [];
  if (retention.daily > 0) parts.push(`${retention.daily} daily`);
  if (retention.weekly > 0) parts.push(`${retention.weekly} weekly`);
  if (retention.monthly > 0) parts.push(`${retention.monthly} monthly`);
  if (retention.yearly > 0) parts.push(`${retention.yearly} yearly`);
  if (parts.length === 0) return "Keeps only the newest verified copy";
  return `Keeps ${parts.join(", ")}`;
}

export function describeSchedule(policy: BackupPolicy): string {
  if (policy.scheduleKind === "interval") {
    const minutes = policy.intervalMinutes ?? 1440;
    if (minutes % 1440 === 0) return `Every ${minutes / 1440} day(s)`;
    if (minutes % 60 === 0) return `Every ${minutes / 60} hour(s)`;
    return `Every ${minutes} minutes`;
  }
  // The engine's own describer, rather than a lookup table of five expressions
  // that fell back to printing raw cron for everything else - including the
  // times someone actually picks.
  const cron = policy.cronExpression ?? "0 2 * * *";
  const label = describeCronExpression(cron);
  return policy.timezone && policy.timezone !== "UTC" ? `${label} (${policy.timezone})` : label;
}

export function describeContents(policy: BackupPolicy): string {
  if (policy.contents === "budget") return "Budget";
  if (policy.contents === "app-db") return "Bench settings";
  return "Budget + Bench settings";
}

/** Newest first - the default order, before anyone sorts a column. */
export function byNewestFirst(artifacts: ArtifactWithLocations[]): ArtifactWithLocations[] {
  return [...artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** What verification found inside a copy, read defensively off its envelope. */
export type ArtifactContents = {
  transactions: number | null;
  accounts: number | null;
  payees: number | null;
  earliest: string | null;
  latest: string | null;
};

export function artifactContents(artifact: ArtifactWithLocations): ArtifactContents {
  const raw = artifact.verification?.data.content;
  const content = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const num = (value: unknown) => (typeof value === "number" ? value : null);
  const str = (value: unknown) => (typeof value === "string" && value ? value : null);

  return {
    transactions: num((content as Record<string, unknown>).transactions),
    accounts: num((content as Record<string, unknown>).accounts),
    payees: num((content as Record<string, unknown>).payees),
    earliest: str((content as Record<string, unknown>).earliestTransaction),
    latest: str((content as Record<string, unknown>).latestTransaction),
  };
}

/**
 * How much budget is in a copy.
 *
 * The number that catches the failure verification cannot: an export that is
 * readable, passes every check, and holds half the transactions it did
 * yesterday.
 */
export function describeContentsSize(contents: ArtifactContents): string {
  if (contents.transactions === null) return "-";
  const parts = [`${contents.transactions.toLocaleString()} txns`];
  if (contents.accounts !== null) parts.push(`${contents.accounts} accts`);
  return parts.join(" · ");
}

/** The span of budget a copy holds - "is this the one from before I broke it?" */
export function describeCoverage(contents: ArtifactContents): string {
  if (!contents.earliest || !contents.latest) return "-";
  return `${contents.earliest} → ${contents.latest}`;
}

/** Where a copy's state sits when sorting: worst first, because that is why you sort. */
const COPY_STATE_ORDER: Record<CopyState, number> = {
  gone: 0,
  damaged: 1,
  unverified: 2,
  verified: 3,
};

export function sortArtifacts(
  artifacts: ArtifactWithLocations[],
  policies: { id: string; name: string }[],
  sort: { key: BackupSortKey; direction: SortDirection } | null
): ArtifactWithLocations[] {
  if (!sort || !sort.direction) return artifacts;
  const { key, direction } = sort;
  const policyNames = new Map(policies.map((policy) => [policy.id, policy.name]));

  const value = (artifact: ArtifactWithLocations): string | number | null => {
    switch (key) {
      case "taken":
        return artifact.createdAt;
      case "contents":
        return artifact.kind === "budget" ? artifact.sourceBudgetName ?? "Budget" : "Bench settings";
      case "inside":
        return artifactContents(artifact).transactions;
      case "covers":
        return artifactContents(artifact).latest;
      case "state":
        return COPY_STATE_ORDER[copyState(artifact)];
      case "rule":
        return (artifact.policyId && policyNames.get(artifact.policyId)) ?? null;
      case "size":
        return artifact.sizeBytes;
    }
  };

  return [...artifacts].sort((a, b) => compareValues(value(a), value(b), direction));
}

/** Rows matching the current filters, in the order they were given. */
export function filterArtifacts(
  artifacts: ArtifactWithLocations[],
  policies: { id: string; name: string }[],
  filters: { search: string; state: string; kind: string; budget: string; policyId: string }
): ArtifactWithLocations[] {
  const needle = filters.search.trim().toLowerCase();
  const policyNames = new Map(policies.map((policy) => [policy.id, policy.name]));

  return artifacts.filter((artifact) => {
    if (filters.kind !== "all" && artifact.kind !== filters.kind) return false;
    if (filters.budget && artifact.sourceBudgetName !== filters.budget) return false;
    if (filters.policyId && artifact.policyId !== filters.policyId) return false;

    if (filters.state !== "all") {
      const state = copyState(artifact);
      const matches =
        filters.state === "problem" ? state === "damaged" || state === "gone" : state === filters.state;
      if (!matches) return false;
    }

    if (!needle) return true;

    // Searched over what is on the row, plus where the copy lives - someone
    // hunting for "the one on the NAS" is searching for the destination.
    return [
      artifact.sourceBudgetName,
      artifact.kind === "app-db" ? "Bench settings" : "budget",
      artifact.policyId ? policyNames.get(artifact.policyId) : null,
      artifact.takenBefore,
      ...artifact.locations.map((location) => location.destinationName),
      ...artifact.locations.map((location) => location.objectKey),
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .some((value) => value.toLowerCase().includes(needle));
  });
}

/** The budgets these copies came from, for the filter that names them. */
export function budgetsInArtifacts(artifacts: ArtifactWithLocations[]): string[] {
  return [
    ...new Set(
      artifacts
        .map((artifact) => artifact.sourceBudgetName)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
    ),
  ].sort((a, b) => a.localeCompare(b));
}
