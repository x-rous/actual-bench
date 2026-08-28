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
 *   * **The source is an enrolled connection**, not a URL. A scheduled backup
 *     has no browser to borrow, so it needs credentials the server can use
 *     unattended, and enrolment is where the operator already granted that. A
 *     budget that has not been enrolled is offered as an explanation rather
 *     than silently missing from the list.
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
  const [source, setSource] = useState(
    String(existing?.sourceRef.data.connectionFingerprint ?? sources[0]?.connectionFingerprint ?? "")
  );
  const [contents, setContents] = useState<BackupPolicy["contents"]>(existing?.contents ?? "both");
  const [destinationIds, setDestinationIds] = useState<string[]>(
    existing?.destinationIds ?? destinations.map((destination) => destination.id)
  );

  const [schedule, setSchedule] = useState<ScheduleValue>(() => ({
    scheduleKind: existing?.scheduleKind ?? "cron",
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
        sourceRef: { version: 1, data: { connectionFingerprint: source } },
        destinationIds,
        verificationLevel,
        encryption: encrypt ? "passphrase" : "none",
        retention,
        scrubEnabled,
        timezone: schedule.timezone,
        scheduleKind: schedule.scheduleKind,
        cronExpression: schedule.cronExpression,
        intervalMinutes: schedule.intervalMinutes,
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

  const needsSource = contents !== "app-db";
  const canSave =
    name.trim().length > 0 &&
    destinationIds.length > 0 &&
    (!needsSource || source.length > 0) &&
    (!encrypt || editing || passphrase.length >= 8) &&
    scheduleValid;

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

          {needsSource && (
            <label className="block space-y-1">
              <span className="font-medium">Budget</span>
              {sources.length === 0 ? (
                <span className="block rounded-md border border-amber-400/40 bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                  No budget is enrolled for unattended use yet. A scheduled backup runs with the
                  browser closed, so it needs credentials the server can use on its own - enrol a
                  connection in Budget File Sync first.
                </span>
              ) : (
                <>
                  <select
                    className={selectClass}
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                  >
                    {sources.map((entry) => (
                      <option key={entry.connectionFingerprint} value={entry.connectionFingerprint}>
                        {entry.label} - {entry.baseUrl}
                      </option>
                    ))}
                  </select>
                  {/* Said every time, not only when the list is empty: these are
                      not the connections in the switcher, and someone whose
                      current budget is missing needs to know why rather than
                      concluding the list is wrong. */}
                  <span className="block text-muted-foreground">
                    Only budgets <strong className="font-medium">enrolled for unattended use</strong>{" "}
                    appear here - a scheduled backup runs with no browser open, so it needs
                    credentials the server can use on its own. Missing the one you are working in?{" "}
                    <a href="/sync" className="underline underline-offset-4">
                      Enrol it in Budget File Sync
                    </a>
                    .
                  </span>
                </>
              )}
            </label>
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

          <div className="space-y-1">
            <span className="font-medium">When</span>
            <SchedulePicker
              value={schedule}
              onChange={setSchedule}
              onValidityChange={setScheduleValid}
              nowMs={nowMs}
            />
          </div>

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
