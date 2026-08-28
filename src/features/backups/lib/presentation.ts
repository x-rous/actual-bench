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
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
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
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const minutes = Math.round((now.getTime() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
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
  const cron = policy.cronExpression ?? "0 2 * * *";
  const known: Record<string, string> = {
    "0 2 * * *": "Daily at 02:00",
    "0 3 * * *": "Daily at 03:00",
    "0 4 * * *": "Daily at 04:00",
    "0 2 * * 0": "Weekly on Sunday at 02:00",
    "0 2 1 * *": "Monthly on the 1st at 02:00",
  };
  const label = known[cron] ?? `Cron: ${cron}`;
  return policy.timezone && policy.timezone !== "UTC" ? `${label} (${policy.timezone})` : label;
}

export function describeContents(policy: BackupPolicy): string {
  if (policy.contents === "budget") return "Budget";
  if (policy.contents === "app-db") return "Bench settings";
  return "Budget + Bench settings";
}

/** Which copies are worth showing first: trouble, then recency. */
export function sortArtifacts(artifacts: ArtifactWithLocations[]): ArtifactWithLocations[] {
  return [...artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
