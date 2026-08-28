"use client";

import Link from "next/link";
import { HardDrive, Key, Loader2, MoreHorizontal, Play, Plus, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
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
 * Everything that decides *what happens*, in the order it has to be decided:
 * somewhere to put copies, a rule that makes them, and whether Bench should
 * take one before you do something risky. The other tab is what came of it.
 *
 * Actions sit beside the thing they act on rather than in the page header,
 * because "Add" means two different things here and a header cannot say which.
 *
 * Runtime detail is deliberately thin: a rule shows whether it is paused, when
 * it last ran and when it runs next, and then links to Automations for history,
 * retries and logs. Re-creating that here would be a second, worse copy of a
 * screen that already exists — and the two would eventually disagree.
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
  onFindBackups: () => void;
  onNewRule: () => void;
  onEditRule: (policy: PolicyWithAutomation) => void;
  onDeleteRule: (policy: PolicyWithAutomation) => void;
  onRunNow: (policyId: string) => void;
  onPreviewRetention: (policy: PolicyWithAutomation) => void;
  onForgetPassphrase: (entry: HeldPassphrase) => void;
  onToggleSafetyPoints: (enabled: boolean) => void;
};

function SectionHeading({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id={id} className="text-xs font-semibold">
        {title}
      </h2>
      {children && <div className="flex gap-1">{children}</div>}
    </div>
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
  onFindBackups,
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
      <section className="border-b border-border px-4 py-3" aria-labelledby="destinations-heading">
        <SectionHeading id="destinations-heading" title="Destinations">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={onFindBackups}
            disabled={discovering || data.destinations.length === 0}
          >
            {discovering ? <Loader2 className="animate-spin" aria-hidden /> : <ScanSearch aria-hidden />}
            Find backups
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onAddDestination}>
            <Plus aria-hidden />
            Add destination
          </Button>
        </SectionHeading>

        {data.destinations.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Nowhere to put a backup yet. Add a folder on this server, or an S3-compatible bucket —
            two of them if you want to survive losing the machine.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {data.destinations.map((destination) => {
              const broken =
                destination.lastFailureAt &&
                (!destination.lastSuccessAt || destination.lastFailureAt > destination.lastSuccessAt);
              return (
                <li key={destination.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <HardDrive
                    className={cn("size-3.5", broken ? "text-destructive" : "text-muted-foreground")}
                    aria-hidden
                  />
                  <span className="font-medium">{destination.name}</span>
                  <span className="text-muted-foreground">
                    {destination.kind === "local"
                      ? String(destination.config.data.path ?? "")
                      : `${String(destination.config.data.bucket ?? "")}${
                          destination.config.data.prefix
                            ? `/${String(destination.config.data.prefix)}`
                            : ""
                        }`}
                  </span>
                  {broken ? (
                    <span className="text-destructive">
                      failed {relativeTime(destination.lastFailureAt)}: {destination.lastFailureReason}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      last wrote {relativeTime(destination.lastSuccessAt)}
                    </span>
                  )}
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => onTestDestination(destination.id)}
                  >
                    Test
                  </Button>
                  {/* Editing and removing are rarer than testing, and one of
                      them is destructive — so they sit behind a menu rather
                      than beside it with the same visual weight. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`More actions for ${destination.name}`}
                    >
                      <MoreHorizontal className="size-3.5" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEditDestination(destination)}>
                        Edit destination
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onRemoveDestination(destination)}
                      >
                        Remove destination
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Backup rules ─────────────────────────────────────────────────── */}
      <section className="border-b border-border px-4 py-3" aria-labelledby="rules-heading">
        <SectionHeading id="rules-heading" title="Backup rules">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={onNewRule}
            disabled={data.destinations.length === 0}
          >
            <Plus aria-hidden />
            New backup rule
          </Button>
        </SectionHeading>

        {data.policies.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {data.destinations.length === 0
              ? "Add a destination first — a rule needs somewhere to write."
              : "No rule yet, so nothing is being copied on a schedule."}
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {data.policies.map((policy) => (
              // Two lines rather than one long one: identity and state on top,
              // the settings underneath. A single row packed with seven facts
              // and five actions reads fine at desk width and collapses into a
              // block on anything narrower.
              <li key={policy.id} className="flex items-start gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("font-medium", !policy.enabled && "text-muted-foreground")}>
                      {policy.name}
                    </span>
                    {/* The rule says what should happen; its automation says
                        what does. When they disagree — a health auto-pause, or
                        Pause pressed on the Automations page — this shows the
                        one that is true, not the comfortable one. */}
                    {!policy.enabled ? (
                      <span className="text-muted-foreground">paused</span>
                    ) : policy.automation?.autoPausedAt ? (
                      <span className="text-destructive">
                        paused after repeated failures: {policy.automation.autoPauseReason}
                      </span>
                    ) : policy.automation && !policy.automation.enabled ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        paused on the Automations page — not running
                      </span>
                    ) : policy.automation?.running ? (
                      <span className="text-muted-foreground">running now…</span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-x-2 text-muted-foreground">
                    <span>{describeContents(policy)}</span>
                    <span>· {describeSchedule(policy)}</span>
                    <span>· {describeRetention(policy)}</span>
                    {policy.encryption === "passphrase" && <span>· encrypted</span>}
                  </div>

                  {/* Just enough runtime to answer "is this working?" — the
                      rest is Automations' job, and duplicating it here would
                      create two screens that eventually disagree. */}
                  <div className="flex flex-wrap gap-x-2 text-muted-foreground">
                    <span>Runs on the server</span>
                    {policy.automation?.lastRunAt && (
                      <span>· last run {relativeTime(policy.automation.lastRunAt)}</span>
                    )}
                    {policy.automation?.nextRunAt && !policy.automation.autoPausedAt && (
                      <span>· next {relativeTime(policy.automation.nextRunAt)}</span>
                    )}
                    <Link href="/automations" className="underline-offset-4 hover:underline">
                      · run history
                    </Link>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => onRunNow(policy.id)}
                    disabled={runningPolicyId !== null}
                  >
                    {runningPolicyId === policy.id ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Play aria-hidden />
                    )}
                    Back up now
                  </Button>

                  {/* "Back up now" is the action people come here for. The rest
                      — including the one that deletes things — belongs behind a
                      menu, not beside it at equal weight. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`More actions for ${policy.name}`}
                    >
                      <MoreHorizontal className="size-3.5" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => onPreviewRetention(policy)}>
                        Preview retention…
                      </DropdownMenuItem>
                      <DropdownMenuItem render={<Link href="/automations" />}>
                        Run history
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEditRule(policy)}>Edit rule</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => onDeleteRule(policy)}>
                        Delete rule
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Passphrases held for rules that are gone ──────────────────────────
          Configuration residue rather than operational state, so it belongs
          here: kept because a backup you cannot open is worse than a secret you
          meant to remove, and listed because keeping it silently would be the
          wrong half of that trade. */}
      {orphanPassphrases.length > 0 && (
        <section className="border-b border-border px-4 py-3" aria-labelledby="passphrases-heading">
          <SectionHeading id="passphrases-heading" title="Passphrases Bench still holds" />
          <ul className="mt-1.5 space-y-1">
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
        </section>
      )}

      {/* ── Recovery points ─────────────────────────────────────────────────
          A setting about when Bench takes a backup on your behalf, so it lives
          with the other decisions about what happens rather than beside the
          copies that resulted. */}
      <section className="px-4 py-3" aria-labelledby="recovery-points-heading">
        <SectionHeading id="recovery-points-heading" title="Recovery points" />
        <label className="mt-1.5 flex items-start gap-2 text-xs">
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
              Before Bench saves a batch of deletions or payee merges, it copies the budget first — so
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
