"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Cloud, HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { browserTimezone } from "@/features/automations/lib/timezones";
import {
  SchedulePicker,
  type ScheduleValue,
} from "@/features/automations/components/SchedulePicker";
import { BudgetSelect, useBudgetChoices } from "@/features/connect/BudgetSelect";
import { EnrolConnection } from "@/features/automations/components/EnrolConnection";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { isHttpApiConnection, useConnectionStore } from "@/store/connection";
import { createPolicy, patchPolicy, type BackupSource } from "../lib/backupsApi";
import type { BackupDestination, BackupPolicy } from "@/lib/app-db/backupRepository";
import { isVaultReady, type VaultSummary } from "@/lib/credentials/vaultSummary";
import { Checkbox } from "@/components/ui/checkbox";
import { PillGroup } from "@/components/ui/pill-group";
import { Select } from "@/components/ui/select";
import { InfoHint } from "@/components/ui/info-hint";
import { describeRetentionReach, describeSchedule, type RetentionTier } from "../lib/presentation";

/**
 * A backup rule (RD-077 / PR-047e).
 *
 * Built around the four things a person decides — what to copy, where to put
 * it, how often, and how long to keep it — rather than around the columns the
 * record happens to have. Everything else has a defensible default and stays
 * out of the way under **More options**.
 *
 * Two decisions show up directly in this form:
 *
 *   * **The source is a connection, not a URL.** A *scheduled* backup has no
 *     browser to borrow, so it needs credentials the server can use unattended,
 *     and enrolment is where the operator already granted that; a budget that
 *     has not been enrolled is offered with an explanation rather than silently
 *     missing. A direct connection cannot be enrolled at all - its budget lives
 *     in this browser - so it is offered as a manual rule instead of being left
 *     out, which is what left those users unable to back anything up.
 *   * **Encryption is off by default.** For most self-hosters the copy lands on
 *     a volume they already control, and encryption mainly adds a way to lose
 *     the data permanently. It matters the moment a copy goes somewhere they do
 *     not control, and the wording says exactly that rather than nudging.
 */


type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: BackupDestination[];
  sources: BackupSource[];
  vault: VaultSummary;
  existing?: BackupPolicy | null;
  /** The rule already holds copies of its budget, so its source is fixed. */
  sourceLocked?: boolean;
  onSaved: () => void;
};

export function BackupRuleDialog({
  open,
  onOpenChange,
  destinations,
  sources,
  vault,
  existing,
  sourceLocked = false,
  onSaved,
}: Props) {
  const editing = Boolean(existing);
  const vaultReady = isVaultReady(vault);
  const [name, setName] = useState(existing?.name ?? "Nightly backup");
  /*
   * Every saved budget connection, and what each one can do.
   *
   * Any mode can run on a schedule once it is enrolled: the server opens an
   * HTTP API budget through actual-http-api and a Direct one in a worker
   * (RD-095). A Direct connection that is not enrolled - or any, when the vault
   * is off - can still be backed up when you ask, as a manual rule: the browser
   * exports it and the server stores it.
   */
  const savedConnections = useConnectionStore((state) => state.instances);
  const choices = savedConnections.map((connection) => {
    const httpApi = isHttpApiConnection(connection);
    const enrolled = sources.some((entry) => entry.connectionFingerprint === connectionFingerprint(connection));
    return {
      fingerprint: connectionFingerprint(connection),
      label: connection.label,
      baseUrl: connection.baseUrl,
      httpApi,
      connection,
      /** A Direct connection that is not enrolled can only run on request. */
      manualOnly: !httpApi && !enrolled,
      enrolled,
    };
  });

  const budgetChoices = useBudgetChoices({
    connections: savedConnections,
    keyOf: connectionFingerprint,
    noteOf: (connection) => {
      const choice = choices.find((entry) => entry.connection === connection);
      if (!choice || choice.enrolled) return undefined;
      return choice.manualOnly ? "manual only until enrolled" : "not enrolled";
    },
  });

  const [source, setSource] = useState(
    String(
      existing?.sourceRef.data.connectionFingerprint ??
        choices.find((choice) => choice.enrolled)?.fingerprint ??
        choices[0]?.fingerprint ??
        ""
    )
  );
  const chosen = choices.find((choice) => choice.fingerprint === source) ?? null;
  const [contents, setContents] = useState<BackupPolicy["contents"]>(existing?.contents ?? "both");
  const [destinationIds, setDestinationIds] = useState<string[]>(
    existing?.destinationIds ?? destinations.map((destination) => destination.id)
  );

  const [schedule, setSchedule] = useState<ScheduleValue>(() => ({
    // The picker only speaks cron and interval; a manual rule has no schedule to
    // show, so it keeps a sensible default here in case the source is changed
    // back to one that can run unattended.
    scheduleKind: existing?.scheduleKind === "interval" ? "interval" : "cron",
    cronExpression: existing?.cronExpression ?? "0 2 * * *",
    intervalMinutes: existing?.intervalMinutes ?? null,
    timezone: existing?.timezone ?? browserTimezone(),
  }));
  const [scheduleValid, setScheduleValid] = useState(true);

  // A clock read during render is impure; snapshot it, and refresh while the
  // dialog is open so "next run in 3 minutes" does not go stale as you read it.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  const [verificationLevel, setVerificationLevel] = useState(existing?.verificationLevel ?? "data");
  const [encrypt, setEncrypt] = useState(existing?.encryption === "passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseAgain, setPassphraseAgain] = useState("");
  const [scrubEnabled, setScrubEnabled] = useState(existing?.scrubEnabled ?? true);

  const [retention, setRetention] = useState(
    existing?.retention ?? {
      daily: 7,
      weekly: 4,
      monthly: 12,
      yearly: 3,
      minimumAgeHours: 24,
      autoProtectionDays: 14,
      autoProtectionCount: 10,
    }
  );

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        contents,
        sourceRef: {
          version: 1,
          data: {
            connectionFingerprint: source,
            // Recorded so the run knows where the bytes come from: "direct"
            // is exported by the browser and uploaded; the others are fetched
            // by the server with the enrolled credential.
            sourceKind: manualOnly ? "direct" : (chosen?.connection.mode ?? "http-api"),
          },
        },
        destinationIds,
        verificationLevel,
        encryption: encrypt ? "passphrase" : "none",
        retention,
        scrubEnabled,
        timezone: schedule.timezone,
        scheduleKind: manualOnly ? "manual" : schedule.scheduleKind,
        cronExpression: manualOnly ? null : schedule.cronExpression,
        intervalMinutes: manualOnly ? null : schedule.intervalMinutes,
        ...(encrypt && passphrase ? { passphrase } : {}),
      };
      return existing ? patchPolicy(existing.id, payload) : createPolicy(payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Backup rule updated" : "Backup rule created");
      onSaved();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // A Direct source that is not enrolled can only be backed up from this
  // browser, so the rule has no schedule and no automation - "Back up now" is
  // the whole of it.
  const manualOnly = chosen?.manualOnly ?? false;
  const needsSource = contents !== "app-db";
  const canSave =
    name.trim().length > 0 &&
    destinationIds.length > 0 &&
    (!needsSource || (source.length > 0 && (chosen?.enrolled || chosen?.manualOnly || false))) &&
    // Typed twice, because a typo here is a backup nobody can open once
    // Bench is gone. Optional on edit - empty keeps the current one - but a
    // new one obeys the same rules.
    (!encrypt || (editing && passphrase.length === 0) || (passphrase.length >= 8 && passphrase === passphraseAgain)) &&
    (manualOnly || scheduleValid);

  const chosenDestinations = destinations.filter((destination) => destinationIds.includes(destination.id));
  const reach = describeRetentionReach(retention);
  const scheduleText = manualOnly
    ? "when you press Back up now"
    : scheduleValid
      ? describeSchedule({
          scheduleKind: schedule.scheduleKind,
          cronExpression: schedule.cronExpression,
          intervalMinutes: schedule.intervalMinutes,
          timezone: schedule.timezone,
        } as BackupPolicy).replace(/^./, (first) => first.toLowerCase())
      : null;
  const whatText =
    contents === "app-db"
      ? "Actual Bench's own data"
      : `${chosen?.label ?? "the budget"}${contents === "both" ? " and Actual Bench's own data" : ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Two columns, so the whole rule fits on one screen: what and where
          with how long and encryption on the left, the schedule and how
          each copy is checked on the right. */}
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit backup rule" : "New backup rule"}</DialogTitle>
          <DialogDescription>What to copy, where it goes, when, and how long to keep it.</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-0.5 pb-1 text-xs md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <Frame title="What to copy">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="font-medium">Rule name</span>
                  <Input value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                {needsSource && (
                  <div className="space-y-1">
                    <span className="block font-medium">Budget</span>
                    <BudgetSelect
                      aria-label="Budget"
                      options={budgetChoices.options}
                      value={source}
                      disabled={budgetChoices.connecting || sourceLocked}
                      emptyLabel="No budget connections saved"
                      onValueChange={async (value) => {
                        // A saved budget joins the session in the background, then
                        // is offered like any connected one (PR-071b).
                        const instance = await budgetChoices.resolve(value);
                        if (instance) setSource(connectionFingerprint(instance));
                      }}
                    />
                    {budgetChoices.dialog}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label
                  text="Contents"
                  hint="Bench data is everything Actual Bench stores apart from your budget: sync flows and mappings, reconciliations, credit cards, plans, assets and loans, automations and saved queries. It lives nowhere else."
                />
                <PillGroup
                  className="w-fit"
                  value={contents}
                  onChange={setContents}
                  options={[
                    { value: "both", label: "Budget + Bench data" },
                    { value: "budget", label: "Budget only" },
                    { value: "app-db", label: "Bench data only" },
                  ]}
                />
              </div>
              {needsSource && sourceLocked && (
                <p className="text-muted-foreground">Fixed: this rule already has backups of this budget.</p>
              )}
              {/* Every budget you have connected to is listed, not only the
                  enrolled ones, with the reason it cannot be used yet and the
                  button that fixes it. */}
              {needsSource && chosen && !chosen.enrolled && (
                <EnrolConnection connection={chosen.connection} onEnrolled={onSaved} allowDirect />
              )}
              {needsSource && choices.length === 0 && (
                <p className="text-muted-foreground">Connect to a budget first - there is nothing to copy yet.</p>
              )}
            </Frame>

            <Frame
              title="Where to store it"
              hint="One destination protects you from mistakes. Two, in different places, protect you from losing the machine."
            >
              {destinations.length === 0 ? (
                <p className="text-muted-foreground">Add a destination first.</p>
              ) : (
                <div className="flex flex-wrap gap-x-5 gap-y-1.5" role="group" aria-label="Destinations">
                  {destinations.map((destination) => {
                    const Icon = destination.kind === "local" ? HardDrive : Cloud;
                    const failing =
                      !!destination.lastFailureAt &&
                      (!destination.lastSuccessAt || destination.lastFailureAt > destination.lastSuccessAt);
                    return (
                      <label key={destination.id} className="flex items-center gap-1.5">
                        <Checkbox
                          checked={destinationIds.includes(destination.id)}
                          onCheckedChange={(next) =>
                            setDestinationIds((current) =>
                              next ? [...current, destination.id] : current.filter((id) => id !== destination.id)
                            )
                          }
                        />
                        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                        <span className="font-medium">{destination.name}</span>
                        <span className={failing ? "text-destructive" : "text-muted-foreground"}>
                          {destination.kind === "local" ? "folder" : "bucket"}
                          {!destination.enabled ? ", disabled" : failing ? ", last write failed" : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {destinationIds.length === 0 && destinations.length > 0 && (
                <p className="text-destructive">Choose at least one destination.</p>
              )}
            </Frame>

            <Frame
              title="How long to keep it"
              hint={`Old copies are thinned out, not all kept: Bench keeps the newest copy of each of the last few days, weeks, months and years, and deletes the rest. One copy can count for more than one of these. Never deleted whatever these say: a pinned copy, one you took by hand, anything newer than ${retention.minimumAgeHours}h, and the newest verified copy.`}
            >
              <div className="grid grid-cols-4 gap-2">
                {(["daily", "weekly", "monthly", "yearly"] as const).map((tier) => (
                  <label key={tier} className="space-y-1">
                    <span className="block font-medium">{TIER_LABEL[tier]}</span>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={retention[tier]}
                      onChange={(event) =>
                        setRetention((current) => ({
                          ...current,
                          // Whole copies only: the server refuses a fraction.
                          [tier]: Math.max(0, Math.round(Number(event.target.value) || 0)),
                        }))
                      }
                    />
                    <span className="block text-[11px] text-muted-foreground">{tierCoverage(tier, retention[tier])}</span>
                  </label>
                ))}
              </div>
              <p className="text-muted-foreground">
                {reach.copies > 0
                  ? `Up to ${reach.copies} copies at any time; the oldest is ${reach.reach} old.`
                  : "Only the newest verified copy is kept."}
              </p>
            </Frame>

            <Frame
              title="Encryption"
              hint="Worth it when a copy goes somewhere you do not control. Without the passphrase nobody can recover an encrypted backup, Bench included."
            >
              <label className="flex items-center gap-2">
                <Checkbox checked={encrypt} disabled={!vaultReady} onCheckedChange={(checked) => setEncrypt(checked)} />
                <span className="font-medium">Encrypt these backups</span>
                {!vaultReady && <span className="text-muted-foreground">- unavailable while stored credentials are locked</span>}
              </label>

              {encrypt && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <Label
                      text="Passphrase"
                      hint={`Write it down somewhere that is not this server.${
                        editing
                          ? " A new passphrase applies to new copies only; older copies keep opening with the one they were taken with."
                          : ""
                      }`}
                    />
                    <Input
                      type="password"
                      value={passphrase}
                      onChange={(event) => setPassphrase(event.target.value)}
                      placeholder={editing ? "unchanged" : "at least 8 characters"}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="block font-medium">Passphrase again</span>
                    <Input
                      type="password"
                      value={passphraseAgain}
                      onChange={(event) => setPassphraseAgain(event.target.value)}
                      autoComplete="new-password"
                      disabled={passphrase.length === 0}
                      aria-invalid={passphraseAgain.length > 0 && passphraseAgain !== passphrase}
                    />
                  </label>
                  {passphrase.length > 0 && passphrase.length < 8 && (
                    <span className="text-destructive sm:col-span-2">Use at least 8 characters.</span>
                  )}
                  {passphraseAgain.length > 0 && passphraseAgain !== passphrase && (
                    <span className="text-destructive sm:col-span-2">The two passphrases do not match.</span>
                  )}
                </div>
              )}
            </Frame>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Frame title="When">
              {/* Said once, where the consequence is: this rule will not run on
                  its own. The picker is hidden rather than disabled: a schedule
                  this rule can never keep is not a setting to evaluate. */}
              {manualOnly ? (
                <p className="text-muted-foreground">
                  Until this budget is enrolled, the rule has no schedule: use{" "}
                  <span className="font-medium text-foreground">Back up now</span> and the copy is exported in
                  this browser, then stored and verified like any other.
                </p>
              ) : (
                <SchedulePicker value={schedule} onChange={setSchedule} onValidityChange={setScheduleValid} nowMs={nowMs} />
              )}
            </Frame>

            <Frame title="Checking each copy">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <Label
                    text="How thoroughly"
                    hint="Quick checks it is a valid archive. Normal opens the database, checks its integrity and counts what is inside. Thorough also runs the full Budget File Health check."
                  />
                  <Select
                    value={verificationLevel}
                    onValueChange={(next) => setVerificationLevel(next as BackupPolicy["verificationLevel"])}
                    options={[
                      { value: "archive", label: "Quick" },
                      { value: "data", label: "Normal" },
                      { value: "deep", label: "Thorough" },
                    ]}
                  />
                </label>
                <div className="flex items-center gap-2 sm:pt-5">
                  <label className="flex items-center gap-2">
                    <Checkbox checked={scrubEnabled} onCheckedChange={(checked) => setScrubEnabled(checked)} />
                    <span className="font-medium">Re-check stored copies weekly</span>
                  </label>
                  <InfoHint label="Re-check stored copies weekly">
                    Storage can go bad quietly. Each week Bench re-reads the newest copies and tells you if one has
                    stopped being readable.
                  </InfoHint>
                </div>
              </div>
            </Frame>
          </div>
        </div>

        {/* The whole rule in one sentence, so what is about to be saved is
            read, not reconstructed from the fields above. */}
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed" aria-live="polite">
          <span className="font-medium">This rule copies</span> {whatText}{" "}
          {chosenDestinations.length > 0 ? (
            <>to {chosenDestinations.map((destination) => destination.name).join(" and ")}</>
          ) : (
            <span className="text-destructive">to no destination yet</span>
          )}
          {scheduleText ? <>, {scheduleText}</> : <span className="text-destructive">, on a schedule that is not complete</span>}
          {reach.copies > 0 ? <>, keeping up to {reach.copies} copies reaching back {reach.reach}</> : <>, keeping only the newest verified copy</>}
          {encrypt ? ", encrypted." : "."}
        </p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {editing ? "Save" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A framed group of the rule's fields, the way the loan settings are framed:
 * a rounded border with the title cutting through its top edge, and an (i)
 * for the explanation instead of a paragraph.
 */
function Frame({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background px-4 pt-1 pb-4">
      <legend className="px-1">
        <span className="inline-flex items-center gap-1 text-sm font-semibold">
          {title}
          {hint && <InfoHint label={title}>{hint}</InfoHint>}
        </span>
      </legend>
      {children}
    </fieldset>
  );
}

/** A field label with its explanation behind an (i). */
function Label({ text, hint }: { text: string; hint: string }) {
  return (
    <span className="flex items-center gap-1 font-medium">
      {text}
      <InfoHint label={text}>{hint}</InfoHint>
    </span>
  );
}

const TIER_LABEL: Record<RetentionTier, string> = {
  daily: "Daily copies",
  weekly: "Weekly copies",
  monthly: "Monthly copies",
  yearly: "Yearly copies",
};

const TIER_UNIT: Record<RetentionTier, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  yearly: ["year", "years"],
};

/** What one retention number means, in words: "one a day, last 7 days". */
function tierCoverage(tier: RetentionTier, count: number): string {
  if (count === 0) return "none kept";
  const [one, many] = TIER_UNIT[tier];
  return count === 1 ? `one, for the latest ${one}` : `one a ${one}, last ${count} ${many}`;
}
