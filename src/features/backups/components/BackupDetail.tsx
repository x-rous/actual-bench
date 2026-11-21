"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Download, Loader2, Pin, PinOff, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { plausibilityOf } from "@/lib/backup/plausibility";
import type { BackupPolicy } from "@/lib/app-db/backupRepository";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  acceptChange,
  attachToRule,
  deleteArtifact,
  downloadUrl,
  inspectBackup,
  setPinned,
  type ArtifactWithLocations,
} from "../lib/backupsApi";
import { COPY_STATE_COPY, copyState, formatBytes, formatDateTime } from "../lib/presentation";
import type { InspectionResult } from "@/lib/backup/inspect";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackupComparePanel } from "./BackupComparePanel";
import { BackupSearchPanel } from "./BackupSearchPanel";

type DetailTab = "details" | "search" | "compare";

/**
 * One backup, in detail (RD-077 / PR-047e).
 *
 * The actions are ordered by how often they are the right one. **Look inside**
 * comes first because the real question in front of a list of backups is "is
 * this the one" — does it still have the account I deleted, does it stop before
 * the import that went wrong — and answering that by restoring means creating a
 * budget, opening it, checking, and cleaning up.
 *
 * **Download** is second and is the restore path that always works: the ZIP
 * goes into Actual's own "Import file", with Bench uninvolved. Everything
 * cleverer in this feature is a convenience on top of that one, which is why it
 * is offered plainly rather than buried.
 */

export function BackupDetail({
  artifact,
  policies,
  onClose,
  onChanged,
}: {
  artifact: ArtifactWithLocations;
  policies: { id: string; name: string; contents: BackupPolicy["contents"] }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [tab, setTab] = useState<DetailTab>("details");
  // A copy with no rule: its rule was deleted, or it was found by discovery.
  const ownerless = !artifact.policyId || !policies.some((policy) => policy.id === artifact.policyId);
  const candidates = policies.filter((policy) => policy.contents === "both" || policy.contents === artifact.kind);
  const [ruleChoice, setRuleChoice] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const state = copyState(artifact);

  const inspect = useMutation({
    mutationFn: () => inspectBackup(artifact.id, passphrase || undefined),
    onSuccess: (result) => {
      setInspection(result);
      if (result.opened && result.verification?.status === "passed") toast.success(result.message);
      else if (!result.opened) toast.warning(result.message);
      else toast.error(result.message);
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const accept = useMutation({
    mutationFn: () => acceptChange(artifact.id),
    onSuccess: () => {
      toast.success("Accepted. This copy now counts as verified, and the next backup is compared with it.");
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const attach = useMutation({
    mutationFn: (policyId: string) => attachToRule(artifact.id, policyId),
    onSuccess: () => {
      toast.success("Attached. The rule's retention now looks after this copy.");
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pin = useMutation({
    mutationFn: () => setPinned(artifact.id, !artifact.pinned),
    onSuccess: () => {
      toast.success(artifact.pinned ? "Unpinned" : "Pinned - retention will never delete this copy");
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteArtifact(artifact.id),
    onSuccess: () => {
      toast.success("Backup deleted everywhere it was stored");
      onChanged();
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const stored = artifact.locations.filter((location) => location.status === "stored");
  const findings = (artifact.verification?.data.findings ?? []) as string[];
  const { unresolved } = plausibilityOf(artifact);
  // A copy that passed can still carry advisory notes (no metadata.json, an
  // accepted change); they are information, not alarms.
  const findingsTone = state === "damaged" ? "text-destructive" : state === "review" ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground";
  const contents = (artifact.verification?.data.content ?? {}) as Record<string, number | string>;

  const details = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={
            state === "verified" ? "status-active" : state === "unverified" || state === "review" ? "secondary" : "destructive"
          }
        >
          {COPY_STATE_COPY[state].label}
        </Badge>
        {artifact.encrypted && <Badge variant="secondary">Encrypted</Badge>}
        {artifact.pinned && <Badge variant="secondary">Pinned</Badge>}
        <span className="text-muted-foreground">{formatBytes(artifact.sizeBytes)}</span>
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {COPY_STATE_COPY[state].detail}
      </p>

      <section className="space-y-1.5">
        <h3 className="text-sm font-semibold">Where it is</h3>
        {artifact.locations.length === 0 ? (
          <p className="text-muted-foreground">Nowhere. Bench has no stored copy of this backup.</p>
        ) : (
          <ul className="space-y-1">
            {artifact.locations.map((location) => (
              <li key={location.id} className="rounded border border-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{location.destinationName ?? "Removed destination"}</span>
                  <span className="text-muted-foreground">{location.status}</span>
                </div>
                <code className="mt-0.5 block break-all text-muted-foreground">{location.objectKey}</code>
                {location.lastError && <p className="mt-1 text-destructive">{location.lastError}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(Object.keys(contents).length > 0 || inspection?.verification) && (
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">What is inside</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries(inspection?.verification?.content ?? contents).map(([key, value]) =>
              value === null || value === undefined ? null : (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground capitalize">
                    {key.replace(/([A-Z])/g, " $1").toLowerCase()}
                  </dt>
                  <dd>{String(value)}</dd>
                </div>
              )
            )}
          </dl>
        </section>
      )}

      {findings.length > 0 && (
        <section className="space-y-1">
          <h3 className={cn("text-sm font-semibold", findingsTone)}>
            {state === "damaged" || state === "review" ? "What Bench found" : "Notes"}
          </h3>
          <ul className="space-y-1">
            {findings.slice(0, 8).map((finding) => (
              <li key={finding} className={findingsTone}>
                {finding}
              </li>
            ))}
          </ul>
        </section>
      )}

      {state === "review" && unresolved.length > 0 && (
        <section className="space-y-1.5 rounded-md border border-amber-400/40 bg-amber-50 p-2 dark:bg-amber-950/20">
          <p className="text-[13px] leading-relaxed">
            Did you delete these yourself? Accepting marks this copy verified and makes it the one
            the next backup is compared with. If you did not, leave it and check the budget.
          </p>
          <Button size="sm" variant="outline" onClick={() => accept.mutate()} disabled={accept.isPending}>
            {accept.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            Accept this change
          </Button>
        </section>
      )}

      {ownerless && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold">No rule looks after this copy</h3>
          <p className="text-muted-foreground">
            Its rule was deleted, or Bench found it in a destination. Retention never removes a copy
            with no rule; attach it to one and that rule&rsquo;s retention keeps or expires it.
          </p>
          {candidates.length === 0 ? (
            <p className="text-muted-foreground">No rule backs up this kind of copy.</p>
          ) : (
            <div className="flex items-center gap-2">
              <Select
                className="h-7 w-auto"
                value={ruleChoice}
                onValueChange={setRuleChoice}
                aria-label="Rule to attach this copy to"
                options={[
                  { value: "", label: "Choose a rule…" },
                  ...candidates.map((policy) => ({ value: policy.id, label: policy.name })),
                ]}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!ruleChoice || attach.isPending}
                onClick={() => attach.mutate(ruleChoice)}
              >
                Attach
              </Button>
            </div>
          )}
        </section>
      )}


      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => inspect.mutate()} disabled={inspect.isPending}>
          {inspect.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
          Look inside
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.open(downloadUrl(artifact.id), "_blank")}>
          <Download aria-hidden />
          Download
        </Button>
        <Button size="sm" variant="outline" onClick={() => pin.mutate()} disabled={pin.isPending}>
          {artifact.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          {artifact.pinned ? "Unpin" : "Pin"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive"
          onClick={() =>
            setConfirm({
              title: "Delete this backup?",
              message:
                stored.length > 1
                  ? `It is removed from all ${stored.length} destinations holding it. This cannot be undone.`
                  : "It is removed from the destination holding it. This cannot be undone.",
              destructiveLabel: "Delete backup",
              onConfirm: () => remove.mutate(),
            })
          }
          disabled={remove.isPending}
        >
          {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
          Delete
        </Button>
      </div>

      {/* Two different objects with two different recoveries. A budget goes
          back into Actual; Bench's own database goes back onto the server
          and never touches Actual at all. Saying the same thing for both
          would be wrong for one of them every time. */}
      <section className="space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Restoring this</h3>

        {/* Instructions are the one thing on this page somebody reads under
            pressure, so they get sentence spacing, a longer line height and
            the body text colour rather than the muted grey used for
            incidental detail. */}
        <div className="space-y-2.5 text-[13px] leading-relaxed text-foreground/80">
          {artifact.kind === "budget" ? (
            <>
              <p>
                Download the file and use{" "}
                <strong className="font-medium text-foreground">Import file &rarr; Actual</strong>{" "}
                in Actual Budget. It creates a <em>new</em> budget from the copy; the budget you
                are using now is not touched.
              </p>
              <p>
                Bench does not import for you: Actual&rsquo;s HTTP API has no import endpoint,
                and a restore that half-worked would be worse than one you did deliberately.
              </p>
            </>
          ) : (
            <>
              <p>
                This is Bench&rsquo;s own metadata database: your sync flows and mappings,
                reconciliation sessions, automations, saved queries and payee-cleanup decisions.
                It holds no budget data, and Actual cannot open it.
              </p>
              <p>
                To restore it, stop Bench, put this file where{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
                  ACTUAL_BENCH_DB_PATH
                </code>{" "}
                points (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
                  /data/actual-bench.sqlite
                </code>{" "}
                by default), and start it again.
              </p>
              <p>
                Stored credentials in it only open with the same vault key: the{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
                  secrets/vault.key
                </code>{" "}
                file beside the database, or{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
                  ACTUAL_BENCH_VAULT_KEY
                </code>{" "}
                if you set one. Restore it without that key and you get every rule back, but Bench
                will ask you to reset the vault and enter the credentials again.
              </p>
            </>
          )}

          {artifact.encrypted && (
            <p>
              This copy is encrypted. Decrypt it before restoring - it carries its own salt, IV
              and tag, so the passphrase is all you need: the one its rule had when this copy
              was taken. The recovery sheet documents the format.
            </p>
          )}
        </div>

        {/* The checksum is for comparing against, so it gets a block of its
            own rather than being run into a sentence: 64 hex characters
            wrapped mid-paragraph are unreadable and unselectable. */}
        <div className="space-y-1 pt-1">
          <div className="text-xs text-muted-foreground">
            SHA-256 of the {artifact.encrypted ? "archive inside, once decrypted" : "file"}
          </div>
          {/* An encrypted copy found by discovery may not record the
              decrypted checksum; the encrypted file's is not shown in its
              place, because it would never match. */}
          {(artifact.encrypted ? artifact.plaintextChecksumSha256 : artifact.checksumSha256) ? (
            <code className="block rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed break-all text-foreground/80">
              {artifact.encrypted ? artifact.plaintextChecksumSha256 : artifact.checksumSha256}
            </code>
          ) : (
            <p className="text-xs text-muted-foreground">Not recorded for this copy.</p>
          )}
          <p className="text-xs text-muted-foreground">
            {artifact.encrypted ? (
              <>
                Compare it with <code className="font-mono">sha256sum</code> on the file you get
                after decrypting; the downloaded <code className="font-mono">.enc</code> file itself
                has a different checksum (<code className="font-mono break-all">{artifact.checksumSha256}</code>).
              </>
            ) : (
              <>
                Compare it with <code className="font-mono">sha256sum</code> on the downloaded file
                to prove nothing changed on the way here.
              </>
            )}
          </p>
        </div>
      </section>
    </>
  );

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      {/* The width has to be set through the same variant the sheet's own base
          class uses (`data-[side=right]:sm:max-w-sm`). A plain `sm:max-w-*`
          loses to it on specificity and is dropped by tailwind-merge, so it
          looks applied and does nothing. */}
      {/* Wider for search and compare, whose tables need the room. */}
      <SheetContent
        className={cn(
          "w-full overflow-y-auto",
          tab === "details" ? "data-[side=right]:sm:max-w-[38rem]" : "data-[side=right]:sm:max-w-[72rem]"
        )}
      >
        <SheetHeader>
          <SheetTitle>
            {artifact.kind === "budget" ? artifact.sourceBudgetName ?? "Budget" : "Bench data"}
          </SheetTitle>
          <SheetDescription>{formatDateTime(artifact.createdAt)}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6 text-xs">
          {artifact.encrypted && (
            <label className="block space-y-1">
              <span className="text-sm font-semibold">Passphrase</span>
              <Input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder="only needed if Bench has not stored it"
                autoComplete="new-password"
              />
            </label>
          )}

          {artifact.kind === "budget" ? (
            <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)}>
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="search">Search inside</TabsTrigger>
                <TabsTrigger value="compare">Compare with now</TabsTrigger>
              </TabsList>
              {/* Kept mounted, so a search or comparison survives a look at
                  the details and back. */}
              <TabsContent value="details" keepMounted className="space-y-5 pt-4">
                {details}
              </TabsContent>
              <TabsContent value="search" keepMounted className="pt-4">
                <BackupSearchPanel artifactId={artifact.id} passphrase={passphrase} />
              </TabsContent>
              <TabsContent value="compare" keepMounted className="pt-4">
                <BackupComparePanel artifactId={artifact.id} passphrase={passphrase} />
              </TabsContent>
            </Tabs>
          ) : (
            details
          )}
        </div>
      </SheetContent>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        state={confirm}
      />
    </Sheet>
  );
}
