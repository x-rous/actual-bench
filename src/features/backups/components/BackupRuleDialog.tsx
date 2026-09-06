"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { browserTimezone } from "@/features/automations/lib/timezones";
import {
  SchedulePicker,
  type ScheduleValue,
} from "@/features/automations/components/SchedulePicker";
import { EnrolConnection } from "@/features/automations/components/EnrolConnection";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { isHttpApiConnection, useConnectionStore } from "@/store/connection";
import { createPolicy, patchPolicy, type BackupSource } from "../lib/backupsApi";
import type { BackupDestination, BackupPolicy } from "@/lib/app-db/backupRepository";

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

const inputClass = "h-8 rounded-md px-2 text-xs md:text-xs";
const selectClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: BackupDestination[];
  sources: BackupSource[];
  vaultEnabled: boolean;
  existing?: BackupPolicy | null;
  onSaved: () => void;
};

export function BackupRuleDialog({
  open,
  onOpenChange,
  destinations,
  sources,
  vaultEnabled,
  existing,
  onSaved,
}: Props) {
  const editing = Boolean(existing);
  const [name, setName] = useState(existing?.name ?? "Nightly backup");
  /*
   * Every saved budget connection, and what each one can do.
   *
   * A Direct connection was left out entirely, which meant a Direct user opened
   * this form, found an empty dropdown and had no way to back anything up at
   * all. What it cannot do is run *unattended*: its budget lives in this browser
   * and there are no credentials a server can use while the operator is away.
   * It can be backed up perfectly well when they ask, so it is offered as a
   * manual rule rather than hidden.
   */
  const savedConnections = useConnectionStore((state) => state.instances);
  const choices = savedConnections.map((connection) => {
    const httpApi = isHttpApiConnection(connection);
    return {
      fingerprint: connectionFingerprint(connection),
      label: connection.label,
      baseUrl: httpApi ? connection.baseUrl : null,
      connection,
      /** Direct connections can only ever run on request. */
      manualOnly: !httpApi,
      enrolled:
        !httpApi ||
        sources.some(
          (entry) => entry.connectionFingerprint === connectionFingerprint(connection)
        ),
    };
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
  const [scrubEnabled, setScrubEnabled] = useState(existing?.scrubEnabled ?? true);
  const [showMore, setShowMore] = useState(false);

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
            // Recorded so the run knows where the bytes come from. A direct
            // source is exported by the browser and uploaded; there is no
            // credential for the server to use.
            sourceKind: manualOnly ? "direct" : "http-api",
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

  // A direct source can only be backed up from the browser holding it, so the
  // rule has no schedule and no automation - "Back up now" is the whole of it.
  const manualOnly = chosen?.manualOnly ?? false;
  const needsSource = contents !== "app-db";
  const canSave =
    name.trim().length > 0 &&
    destinationIds.length > 0 &&
    (!needsSource || (source.length > 0 && (chosen?.enrolled ?? false))) &&
    (!encrypt || editing || passphrase.length >= 8) &&
    (manualOnly || scheduleValid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit backup rule" : "New backup rule"}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1 text-xs">
          <label className="block space-y-1">
            <span className="font-medium">Name</span>
            <Input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="block space-y-1">
            <span className="font-medium">What to copy</span>
            <select
              className={selectClass}
              value={contents}
              onChange={(event) => setContents(event.target.value as BackupPolicy["contents"])}
            >
              <option value="both">The budget and Bench&rsquo;s own settings</option>
              <option value="budget">Just the budget</option>
              <option value="app-db">Just Bench&rsquo;s settings</option>
            </select>
            <span className="block text-muted-foreground">
              Bench&rsquo;s settings are your sync rules, mappings, reconciliation sessions and
              automations - everything you have taught it, which lives nowhere else.
            </span>
          </label>

          {/* Only shown when there is a budget to name: a copy of Bench's own
              settings is a local database export and needs no connection at
              all, so asking for one would be asking a question with no bearing
              on the answer. */}
          {needsSource && (
            <div className="space-y-1">
              <label className="block space-y-1">
                <span className="font-medium">Budget</span>
                <select
                  className={selectClass}
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                >
                  {choices.length === 0 && <option value="">No budget connections saved</option>}
                  {choices.map((choice) => (
                    <option key={choice.fingerprint} value={choice.fingerprint}>
                      {choice.label}
                      {choice.baseUrl ? ` - ${choice.baseUrl}` : " - Direct (this browser)"}
                      {choice.manualOnly ? "  (manual only)" : choice.enrolled ? "" : "  (not enrolled)"}
                    </option>
                  ))}
                </select>
              </label>

              {/* Every budget you have connected to is listed, not only the
                  enrolled ones - the budget you are working in should appear in
                  the list of budgets you can back up, with the reason it cannot
                  be used yet and the button that fixes it. */}
              {chosen && !chosen.enrolled && !chosen.manualOnly && (
                <EnrolConnection
                  connection={chosen.connection}
                  compact
                  onEnrolled={onSaved}
                />
              )}

              {/* Said once, where the consequence is: this rule will not run on
                  its own. Not an apology - the copy is the same copy, stored and
                  verified the same way. */}
              {manualOnly && (
                <span className="block text-muted-foreground">
                  This budget is open in your browser, so Bench cannot reach it while you are away.
                  The rule has no schedule: use <span className="font-medium">Back up now</span> and
                  the copy is exported here, then stored and verified like any other.
                </span>
              )}

              {choices.length === 0 && (
                <span className="block text-muted-foreground">
                  Connect to a budget first - there is nothing to copy yet.
                </span>
              )}
            </div>
          )}

          <fieldset className="space-y-1">
            <legend className="font-medium">Where to put it</legend>
            {destinations.length === 0 ? (
              <p className="text-muted-foreground">Add a destination first.</p>
            ) : (
              destinations.map((destination) => (
                <label key={destination.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={destinationIds.includes(destination.id)}
                    onChange={(event) =>
                      setDestinationIds((current) =>
                        event.target.checked
                          ? [...current, destination.id]
                          : current.filter((id) => id !== destination.id)
                      )
                    }
                  />
                  <span>{destination.name}</span>
                  <span className="text-muted-foreground">
                    {destination.kind === "local" ? "folder" : "bucket"}
                  </span>
                </label>
              ))
            )}
            {destinationIds.length === 1 && destinations.length > 1 && (
              <p className="text-muted-foreground">
                One destination protects you from mistakes. Two protect you from losing the machine.
              </p>
            )}
          </fieldset>

          {/* Hidden rather than disabled: a schedule this rule can never keep is
              not a setting the reader should have to evaluate and dismiss. */}
          {!manualOnly && (
            <div className="space-y-1">
              <span className="font-medium">When</span>
              <SchedulePicker
                value={schedule}
                onChange={setSchedule}
                onValidityChange={setScheduleValid}
                nowMs={nowMs}
              />
            </div>
          )}

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={encrypt}
              disabled={!vaultEnabled}
              onChange={(event) => setEncrypt(event.target.checked)}
            />
            <span>
              <span className="font-medium">Encrypt these backups</span>
              <span className="block text-muted-foreground">
                {vaultEnabled
                  ? "Worth it when a copy goes somewhere you do not control. Bench cannot recover an encrypted backup without the passphrase - nobody can."
                  : "Set SYNC_VAULT_KEY on the server to enable encryption."}
              </span>
            </span>
          </label>

          {encrypt && (
            <label className="block space-y-1">
              <span className="font-medium">Passphrase</span>
              <Input
                className={inputClass}
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder={editing ? "unchanged" : "at least 8 characters"}
                autoComplete="new-password"
              />
              <span className="block text-muted-foreground">
                Write this down somewhere that is not on this server. It is the single point of
                failure in the whole arrangement.
              </span>
            </label>
          )}

          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setShowMore((current) => !current)}
          >
            {showMore ? "Fewer options" : "More options"}
          </button>

          {showMore && (
            <div className="space-y-3 rounded-md border border-border p-2">
              <label className="block space-y-1">
                <span className="font-medium">How thoroughly to check each copy</span>
                <select
                  className={selectClass}
                  value={verificationLevel}
                  onChange={(event) =>
                    setVerificationLevel(event.target.value as BackupPolicy["verificationLevel"])
                  }
                >
                  <option value="archive">Quick - it is a valid archive</option>
                  <option value="data">Normal - open the database and count what is inside</option>
                  <option value="deep">Thorough - the full Budget File Health check</option>
                </select>
              </label>

              <fieldset className="space-y-1">
                <legend className="font-medium">How many to keep</legend>
                <div className="grid grid-cols-4 gap-2">
                  {(["daily", "weekly", "monthly", "yearly"] as const).map((tier) => (
                    <label key={tier} className="space-y-1">
                      <span className="block capitalize text-muted-foreground">{tier}</span>
                      <Input
                        className={inputClass}
                        type="number"
                        min={0}
                        value={retention[tier]}
                        onChange={(event) =>
                          setRetention((current) => ({
                            ...current,
                            [tier]: Math.max(0, Number(event.target.value)),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <p className="text-muted-foreground">
                  Bench never deletes a pinned copy, anything newer than{" "}
                  {retention.minimumAgeHours}h, or the newest verified copy - whatever these numbers
                  say.
                </p>
              </fieldset>

              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={scrubEnabled}
                  onChange={(event) => setScrubEnabled(event.target.checked)}
                />
                <span>
                  <span className="font-medium">Re-check stored copies weekly</span>
                  <span className="block text-muted-foreground">
                    Storage rots quietly. This re-reads the newest few copies and tells you if one
                    has stopped being readable.
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>

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
