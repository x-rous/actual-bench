"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Cloud,
  HardDrive,
  History,
  Key,
  ListChecks,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
 * Laid out in the order it is decided, each at full width: somewhere to put
 * copies, the rules that write to them, then whether Bench should take one
 * before you do something risky. Side by side, the rules table - schedule,
 * retention and its actions - had to scroll sideways; stacked, every row
 * fits on one line.
 *
 * A rule needs somewhere to write, so the rules column says so - with the
 * button that would create one disabled and saying why - until a destination
 * exists, rather than greying out a table nobody can read. Each side names
 * the other: a destination says how many rules use it, a rule which
 * destinations it writes to, and a rule whose destination is gone or failing
 * says that in the row.
 *
 * Runtime detail on a rule is deliberately thin: its status, when it last ran,
 * when it runs next, and a way through to Automations for history, retries
 * and logs. Re-creating that here would be a second, worse copy of a screen
 * that already exists, and the two would eventually disagree.
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
  onAddRule: () => void;
  onEditRule: (policy: PolicyWithAutomation) => void;
  onDeleteRule: (policy: PolicyWithAutomation) => void;
  onRunNow: (policyId: string) => void;
  onPreviewRetention: (policy: PolicyWithAutomation) => void;
  onForgetPassphrase: (entry: HeldPassphrase) => void;
  onToggleSafetyPoints: (enabled: boolean) => void;
};

const headerCell = "whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide";
const cell = "whitespace-nowrap px-3 py-1.5";

function Section({
  id,
  title,
  actions,
  className,
  children,
}: {
  id: string;
  title: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // Equal space on all four sides: the tables sat hard against the section
    // divider while having 16px either side of them.
    <section className={cn("border-b border-border p-4", className)} aria-labelledby={id}>
      <div className="mb-1.5 flex min-h-7 items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {actions && <div className="flex gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * When this rule last produced a copy.
 *
 * The artifacts are the record a manual rule leaves: it has no automation, so
 * `automation.lastRunAt` is null for it no matter how many backups have been
 * taken by hand.
 */
function newestCopyAt(artifacts: RecoveryCenterData["artifacts"], policyId: string): string | null {
  let newest: string | null = null;
  for (const artifact of artifacts) {
    if (artifact.policyId !== policyId) continue;
    if (newest === null || artifact.createdAt > newest) newest = artifact.createdAt;
  }
  return newest;
}

function isFailing(destination: BackupDestination): boolean {
  return (
    !!destination.lastFailureAt &&
    (!destination.lastSuccessAt || destination.lastFailureAt > destination.lastSuccessAt)
  );
}

function whereOf(destination: BackupDestination): string {
  if (destination.kind === "local") return String(destination.config.data.path ?? "");
  const bucket = String(destination.config.data.bucket ?? "");
  return destination.config.data.prefix ? `${bucket}/${String(destination.config.data.prefix)}` : bucket;
}

/** A destination's state in words; colour only supports it. */
function DestinationState({ destination }: { destination: BackupDestination }) {
  if (!destination.enabled) return <span className="text-muted-foreground">Disabled</span>;
  if (isFailing(destination)) {
    return (
      <span className="flex items-center gap-1 text-destructive" title={destination.lastFailureReason ?? undefined}>
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        Failed {relativeTime(destination.lastFailureAt)}
        {destination.lastFailureReason && <span className="sr-only">: {destination.lastFailureReason}</span>}
      </span>
    );
  }
  if (!destination.lastSuccessAt) return <span className="text-muted-foreground">Not written to yet</span>;
  return <span className="text-muted-foreground">OK · wrote {relativeTime(destination.lastSuccessAt)}</span>;
}

/**
 * What a rule is doing, in one word. The rule says what should happen; its
 * automation says what does. When they disagree - a health auto-pause, or
 * Pause pressed on the Automations page - this shows the one that is true,
 * not the comfortable one.
 */
function RuleStatus({ policy }: { policy: PolicyWithAutomation }) {
  const automation = policy.automation;
  if (!policy.enabled) return <Badge variant="status-inactive">Paused</Badge>;
  if (automation?.autoPausedAt) {
    const reason = `Paused after repeated failures: ${automation.autoPauseReason ?? "see its run history"}`;
    return (
      <Badge variant="status-error" title={reason}>
        Auto-paused
        <span className="sr-only">. {reason}</span>
      </Badge>
    );
  }
  if (automation && !automation.enabled) {
    return (
      <Badge variant="status-warning" title="Paused on the Automations page, so it is not running">
        Paused in Automations
      </Badge>
    );
  }
  if (automation?.running) return <Badge variant="secondary">Running</Badge>;
  return <Badge variant="status-active">Active</Badge>;
}

/** The destinations a rule writes to, with the ones that are gone or failing said plainly. */
function WritesTo({ policy, destinations }: { policy: PolicyWithAutomation; destinations: Map<string, BackupDestination> }) {
  if (policy.destinationIds.length === 0) {
    return (
      <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        No destination
      </span>
    );
  }
  const names = policy.destinationIds.map((id) => destinations.get(id));
  const missing = names.filter((entry) => !entry).length;
  const failing = names.filter((entry): entry is BackupDestination => !!entry && (isFailing(entry) || !entry.enabled));
  const label = names
    .filter((entry): entry is BackupDestination => !!entry)
    .map((entry) => entry.name)
    .join(", ");
  const problem =
    missing > 0
      ? `${missing} of its destinations ${missing === 1 ? "was" : "were"} removed`
      : failing.length > 0
        ? `${failing.map((entry) => entry.name).join(", ")} ${failing.length === 1 ? "is" : "are"} ${failing.every((entry) => !entry.enabled) ? "disabled" : "failing"}`
        : null;
  return (
    <span
      className={cn("flex items-center gap-1", problem ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
      title={problem ?? label}
    >
      {problem && <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{label || "Removed destination"}</span>
      {problem && <span className="sr-only">: {problem}</span>}
    </span>
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
  onAddRule,
  onEditRule,
  onDeleteRule,
  onRunNow,
  onPreviewRetention,
  onForgetPassphrase,
  onToggleSafetyPoints,
}: Props) {
  const lastCopyAt = (policyId: string) => newestCopyAt(data.artifacts, policyId);
  const destinations = new Map(data.destinations.map((destination) => [destination.id, destination]));
  const rulesUsing = (destinationId: string) =>
    data.policies.filter((policy) => policy.destinationIds.includes(destinationId)).length;
  const noDestination = data.destinations.length === 0;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-border">
        {/* ── Destinations ───────────────────────────────────────────────────
            Health lives on the destination because it fails independently of
            whichever rule writes to it. */}
        <Section
          id="destinations-heading"
          title="1 · Destinations"
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onScanDestinations}
                disabled={discovering || noDestination}
                aria-label="Scan for backups"
                title="Read the manifest beside every backup in your destinations and add anything Bench does not already know about. It only adds - nothing is changed, moved or deleted."
              >
                {discovering ? <Loader2 className="animate-spin" aria-hidden /> : <ScanSearch aria-hidden />}
                Scan
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
          {noDestination ? (
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
                      Destination
                    </th>
                    <th scope="col" className={headerCell}>
                      Where
                    </th>
                    <th scope="col" className={headerCell}>
                      State
                    </th>
                    <th scope="col" className={cn(headerCell, "text-right")} title="Backup rules writing here">
                      Used by
                    </th>
                    <th scope="col" className={headerCell}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.destinations.map((destination) => {
                    const Icon = destination.kind === "local" ? HardDrive : Cloud;
                    const used = rulesUsing(destination.id);
                    return (
                      <tr key={destination.id} className="border-t border-border/60 align-middle">
                        <td className={cell}>
                          <span className="flex items-center gap-1.5 font-medium">
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            {destination.name}
                          </span>
                        </td>
                        <td className={cn(cell, "max-w-md truncate text-muted-foreground")} title={whereOf(destination)}>
                          {destination.kind === "local" ? "Folder " : "Bucket "}
                          <code className="font-mono">{whereOf(destination)}</code>
                        </td>
                        <td className={cell}>
                          <DestinationState destination={destination} />
                        </td>
                        <td
                          className={cn(cell, "text-right", used === 0 && "text-muted-foreground")}
                          title={used === 0 ? "No rule writes here yet" : `Used by ${used} rule${used === 1 ? "" : "s"}`}
                        >
                          {used === 0 ? "no rules" : `${used} rule${used === 1 ? "" : "s"}`}
                        </td>
                        <td className="w-10 px-1 py-1 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={<Button size="icon-xs" variant="ghost" aria-label={`Actions for ${destination.name}`} />}
                            >
                              <MoreHorizontal className="size-3.5" aria-hidden />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem
                                onClick={() => onTestDestination(destination.id)}
                                title="Write a test file here, read it back and compare checksums, then delete it"
                              >
                                <ListChecks aria-hidden />
                                Test
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onEditDestination(destination)}>
                                <Pencil aria-hidden />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onClick={() => onRemoveDestination(destination)}>
                                <Trash2 aria-hidden />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ── Backup rules ───────────────────────────────────────────────────── */}
        <Section
          id="rules-heading"
          title="2 · Backup rules"
          className="border-b-0"
          actions={
            data.policies.length > 0 && (
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={onAddRule}
                title="Choose what to copy, where to put it, how often, and how long to keep it"
              >
                <Plus aria-hidden />
                New backup rule
              </Button>
            )
          }
        >
          {data.policies.length === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border p-4 text-xs">
              {noDestination ? (
                <p className="text-muted-foreground">
                  Rules write to a destination, so add one first. Then a rule decides what to copy,
                  how often, and how long to keep it.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  No rule yet, so nothing is being copied. A rule decides what to copy, which
                  destinations it goes to, how often, and how long to keep it.
                </p>
              )}
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={onAddRule}
                disabled={noDestination}
                title={noDestination ? "Add a destination first - a rule needs somewhere to write" : undefined}
              >
                <Plus aria-hidden />
                {noDestination ? "New backup rule" : "Create your first backup rule"}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th scope="col" className={headerCell}>
                      Rule
                    </th>
                    <th scope="col" className={headerCell}>
                      Status
                    </th>
                    <th scope="col" className={headerCell}>
                      Copies
                    </th>
                    <th scope="col" className={headerCell}>
                      Writes to
                    </th>
                    <th scope="col" className={headerCell}>
                      Schedule
                    </th>
                    <th scope="col" className={headerCell}>
                      Next run
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
                  {data.policies.map((policy) => {
                    const nextRun =
                      policy.enabled && policy.automation?.enabled && !policy.automation.autoPausedAt
                        ? policy.automation.nextRunAt
                        : null;
                    return (
                      <tr key={policy.id} className="border-t border-border/60 align-middle">
                        <td className={cn(cell, "max-w-56 truncate font-medium", !policy.enabled && "text-muted-foreground")} title={policy.name}>
                          {policy.name}
                        </td>
                        <td className={cell}>
                          <RuleStatus policy={policy} />
                        </td>
                        <td className={cn(cell, "text-muted-foreground")}>
                          <span className="flex items-center gap-1">
                            {describeContents(policy)}
                            {policy.encryption === "passphrase" && (
                              <span title="Encrypted with a passphrase">
                                <Lock className="size-3.5" aria-hidden />
                                <span className="sr-only">, encrypted</span>
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={cn(cell, "max-w-48")}>
                          <WritesTo policy={policy} destinations={destinations} />
                        </td>
                        <td className={cn(cell, "text-muted-foreground")}>{describeSchedule(policy)}</td>
                        <td className={cn(cell, "text-muted-foreground")}>{nextRun ? relativeTime(nextRun) : "-"}</td>
                        <td className={cn(cell, "text-muted-foreground")}>{describeRetention(policy)}</td>
                        <td className={cn(cell, "text-muted-foreground")}>
                          {/* From the copies for a manual rule, which has no
                              automation to have a last run. Reading the
                              automation alone left the column empty however
                              many backups the user had just taken by hand. */}
                          {relativeTime(policy.automation?.lastRunAt ?? lastCopyAt(policy.id))}
                        </td>
                        <td className={cell}>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() => onRunNow(policy.id)}
                              disabled={runningPolicyId !== null}
                              title={
                                policy.scheduleKind === "manual"
                                  ? "Take a copy now. Backups taken by hand are kept until you delete them."
                                  : "Take a copy now, outside the schedule. Backups taken by hand are kept until you delete them."
                              }
                            >
                              {runningPolicyId === policy.id ? (
                                <Loader2 className="animate-spin" aria-hidden />
                              ) : (
                                <Play aria-hidden />
                              )}
                              Back up now
                            </Button>
                            {/* Only where there is history to open. A manual rule
                                has no automation, so this led to a page listing
                                everyone else's runs and none of its own. A real
                                link, styled as a button: open in a new tab and
                                copy the address still work. */}
                            {policy.automation && (
                              <Link
                                href={`/automations/runs?automation=${policy.automation.id}`}
                                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-6 text-xs")}
                                title="Every run of this rule, with its result, duration and log"
                              >
                                <History aria-hidden />
                                Run history
                              </Link>
                            )}
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

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
          <Checkbox className="mt-0.5"
            checked={safetyEnabled}
            disabled={safetyPending}
            onCheckedChange={(checked) => onToggleSafetyPoints(checked)}
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
