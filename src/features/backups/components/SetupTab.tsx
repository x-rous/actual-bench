"use client";

import Link from "next/link";
import {
  HardDrive,
  History,
  Key,
  ListChecks,
  Loader2,
  Pencil,
  Play,
  Plus,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  describeContents,
  describeRetention,
  describeSchedule,
  relativeTime,
} from "../lib/presentation";
import type {
  HeldPassphrase,
  PolicyWithAutomation,
  RecoveryCenterData,
} from "../lib/backupsApi";
import type { BackupDestination } from "@/lib/app-db/backupRepository";

/**
 * Setting backups up (RD-077 / PR-047).
 *
 * Everything that decides *what happens*, in the order it has to be decided:
 * somewhere to put copies, a rule that makes them, and whether Bench should
 * take one before you do something risky. The other tab is what came of it.
 *
 * Destinations and rules are tables, like every other list of records in Bench,
 * because that is what they are: a fixed set of columns, scanned down rather
 * than read across. Actions sit beside the thing they act on rather than in the
 * page header — "Add" means two different things here and a header cannot say
 * which.
 *
 * Runtime detail on a rule is deliberately thin: whether it is paused, when it
 * last ran, when it runs next, and a way through to Automations for history,
 * retries and logs. Re-creating that here would be a second, worse copy of a
 * screen that already exists, and the two would eventually disagree.
 */

type Props = {
  data: RecoveryCenterData;
  discovering: boolean;
  runningPolicyId: string | null;
  safetyEnabled: boolean;
  safetyPending: boolean;
  orphanPassphrases: HeldPassphrase[];
  onAddDestination: () => void;
  onEditDestination: (destination: BackupDestination) => void;
  onRemoveDestination: (destination: BackupDestination) => void;
  onTestDestination: (destinationId: string) => void;
  onScanDestinations: () => void;
  onNewRule: () => void;
  onEditRule: (policy: PolicyWithAutomation) => void;
  onDeleteRule: (policy: PolicyWithAutomation) => void;
  onRunNow: (policyId: string) => void;
  onPreviewRetention: (policy: PolicyWithAutomation) => void;
  onForgetPassphrase: (entry: HeldPassphrase) => void;
  onToggleSafetyPoints: (enabled: boolean) => void;
};

const headerCell = "px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide";

function Section({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // Equal space on all four sides: the tables sat hard against the section
    // divider while having 16px either side of them.
    <section className="border-b border-border p-4" aria-labelledby={id}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {actions && <div className="flex gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function SetupTab({
  data,
  discovering,
  runningPolicyId,
  safetyEnabled,
  safetyPending,
  orphanPassphrases,
  onAddDestination,
  onEditDestination,
  onRemoveDestination,
  onTestDestination,
  onScanDestinations,
  onNewRule,
  onEditRule,
  onDeleteRule,
  onRunNow,
  onPreviewRetention,
  onForgetPassphrase,
  onToggleSafetyPoints,
}: Props) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* ── Destinations ─────────────────────────────────────────────────────
          Health lives on the destination because it fails independently of
          whichever rule discovered it. */}
      <Section
        id="destinations-heading"
        title="Destinations"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onScanDestinations}
              disabled={discovering || data.destinations.length === 0}
              title="Read the manifest beside every backup in your destinations and add anything Bench does not already know about. It only adds - nothing is changed, moved or deleted."
            >
              {discovering ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <ScanSearch aria-hidden />
              )}
              Scan for backups
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={onAddDestination}
              title="Add a folder on this server, or an S3-compatible bucket"
            >
              <Plus aria-hidden />
              Add destination
            </Button>
          </>
        }
      >
        {data.destinations.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nowhere to put a backup yet. Add a folder on this server, or an S3-compatible bucket -
            two of them if you want to survive losing the machine.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th scope="col" className={headerCell}>
                    Name
                  </th>
                  <th scope="col" className={headerCell}>
                    Where
                  </th>
                  <th scope="col" className={headerCell}>
                    State
                  </th>
                  <th scope="col" className={cn(headerCell, "text-right")}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.destinations.map((destination) => {
                  const broken =
                    destination.lastFailureAt &&
                    (!destination.lastSuccessAt ||
                      destination.lastFailureAt > destination.lastSuccessAt);
                  return (
                    <tr key={destination.id} className="border-t border-border/60 align-middle">
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1.5 font-medium">
                          <HardDrive
                            className={cn(
                              "size-3.5",
                              broken ? "text-destructive" : "text-muted-foreground"
                            )}
                            aria-hidden
                          />
                          {destination.name}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {destination.kind === "local"
                          ? String(destination.config.data.path ?? "")
                          : `${String(destination.config.data.bucket ?? "")}${
                              destination.config.data.prefix
                                ? `/${String(destination.config.data.prefix)}`
                                : ""
                            }`}
                      </td>
                      <td className="px-3 py-1.5">
                        {broken ? (
                          <span className="text-destructive">
                            failed {relativeTime(destination.lastFailureAt)}:{" "}
                            {destination.lastFailureReason}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            last wrote {relativeTime(destination.lastSuccessAt)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => onTestDestination(destination.id)}
                            title="Write a test file here, read it back and compare checksums, then delete it"
                          >
                            Test
                          </Button>
                          {/* Icon-only for the two actions with settled icons,
                              so the row does not spend half its width on words
                              everybody already knows. Both keep a label for
                              screen readers and a tooltip for everyone else,
                              and the destructive one still confirms. */}
                          <Button
                            variant="outline"
                            size="icon-xs"
                            onClick={() => onEditDestination(destination)}
                            aria-label={`Edit ${destination.name}`}
                            title="Change this destination's path, bucket or credentials"
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-xs"
                            className="text-destructive"
                            onClick={() => onRemoveDestination(destination)}
                            aria-label={`Remove ${destination.name}`}
                            title="Stop writing here. The copies already in it are left exactly where they are."
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Backup rules ─────────────────────────────────────────────────── */}
      <Section
        id="rules-heading"
        title="Backup rules"
        actions={
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={onNewRule}
            disabled={data.destinations.length === 0}
            title={
              data.destinations.length === 0
                ? "Add a destination first - a rule needs somewhere to write"
                : "Choose what to copy, where to put it, how often, and how long to keep it"
            }
          >
            <Plus aria-hidden />
            New backup rule
          </Button>
        }
      >
        {data.policies.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {data.destinations.length === 0
              ? "Add a destination first - a rule needs somewhere to write."
              : "No rule yet, so nothing is being copied on a schedule."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th scope="col" className={headerCell}>
                    Rule
                  </th>
                  <th scope="col" className={headerCell}>
                    Copies
                  </th>
                  <th scope="col" className={headerCell}>
                    Schedule
                  </th>
                  <th scope="col" className={headerCell}>
                    Keeps
                  </th>
                  <th scope="col" className={headerCell}>
                    Last run
                  </th>
                  <th scope="col" className={cn(headerCell, "text-right")}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.policies.map((policy) => (
                  <tr key={policy.id} className="border-t border-border/60 align-middle">
                    <td className="px-3 py-1.5">
                      <span
                        className={cn("font-medium", !policy.enabled && "text-muted-foreground")}
                      >
                        {policy.name}
                      </span>
                      {/* The rule says what should happen; its automation says
                          what does. When they disagree - a health auto-pause,
                          or Pause pressed on the Automations page - this shows
                          the one that is true, not the comfortable one. */}
                      {!policy.enabled ? (
                        <span className="block text-muted-foreground">paused</span>
                      ) : policy.automation?.autoPausedAt ? (
                        <span className="block text-destructive">
                          paused after repeated failures: {policy.automation.autoPauseReason}
                        </span>
                      ) : policy.automation && !policy.automation.enabled ? (
                        <span className="block text-amber-700 dark:text-amber-400">
                          paused on the Automations page - not running
                        </span>
                      ) : policy.automation?.running ? (
                        <span className="block text-muted-foreground">running now…</span>
                      ) : (
                        <span className="block text-muted-foreground">runs on the server</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {describeContents(policy)}
                      {policy.encryption === "passphrase" && (
                        <span className="block">encrypted</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {describeSchedule(policy)}
                      {policy.automation?.nextRunAt && !policy.automation.autoPausedAt && (
                        <span className="block">next {relativeTime(policy.automation.nextRunAt)}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {describeRetention(policy)}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {relativeTime(policy.automation?.lastRunAt ?? null)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => onRunNow(policy.id)}
                          disabled={runningPolicyId !== null}
                          title="Take a copy now, outside the schedule. Backups taken by hand are kept until you delete them."
                        >
                          {runningPolicyId === policy.id ? (
                            <Loader2 className="animate-spin" aria-hidden />
                          ) : (
                            <Play aria-hidden />
                          )}
                          Back up now
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs"
                          render={
                            <Link
                              href={
                                policy.automation
                                  ? `/automations/runs?automation=${policy.automation.id}`
                                  : "/automations/runs"
                              }
                            />
                          }
                          title="Every run of this rule, with its result, duration and log"
                        >
                          <History aria-hidden />
                          Run history
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => onPreviewRetention(policy)}
                          title="See exactly which copies this rule would remove, and why, before anything is deleted"
                        >
                          <ListChecks aria-hidden />
                          Retention
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-xs"
                          onClick={() => onEditRule(policy)}
                          aria-label={`Edit ${policy.name}`}
                          title="Change what this rule copies, where, when, and how long it keeps it"
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-xs"
                          className="text-destructive"
                          onClick={() => onDeleteRule(policy)}
                          aria-label={`Delete ${policy.name}`}
                          title="Stop this rule running. The backups it already took are kept."
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Passphrases held for rules that are gone ──────────────────────────
          Configuration residue rather than operational state, so it belongs
          here: kept because a backup you cannot open is worse than a secret you
          meant to remove, and listed because keeping it silently would be the
          wrong half of that trade. */}
      {orphanPassphrases.length > 0 && (
        <Section id="passphrases-heading" title="Passphrases Bench still holds">
          <ul className="space-y-1">
            {orphanPassphrases.map((entry) => (
              <li key={entry.ref} className="flex flex-wrap items-center gap-2 text-xs">
                <Key className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="font-medium">{entry.label}</span>
                <span className="text-muted-foreground">
                  its rule is gone, but {entry.artifactCount} encrypted backup
                  {entry.artifactCount === 1 ? "" : "s"} still need
                  {entry.artifactCount === 1 ? "s" : ""} it
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => onForgetPassphrase(entry)}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Recovery points ─────────────────────────────────────────────────
          A setting about when Bench takes a backup on your behalf, so it lives
          with the other decisions about what happens rather than beside the
          copies that resulted. */}
      <section className="p-4" aria-labelledby="recovery-points-heading">
        <h2 id="recovery-points-heading" className="mb-1.5 text-sm font-semibold">
          Recovery points
        </h2>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={safetyEnabled}
            disabled={safetyPending}
            onChange={(event) => onToggleSafetyPoints(event.target.checked)}
          />
          <span>
            <span className="font-medium">Take a recovery point before risky changes</span>
            <span className="block text-muted-foreground">
              Off by default. With it on, before Bench saves a batch of deletions or payee merges it
              copies the budget first - so
              there is something from five minutes ago, not just from last night. Several changes in
              one session share a recovery point, and these expire on their own instead of piling up.
              If one cannot be taken, Bench asks before continuing rather than quietly going ahead.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
