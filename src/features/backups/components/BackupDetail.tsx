"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, Loader2, Pin, PinOff, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  deleteArtifact,
  downloadUrl,
  inspectBackup,
  setPinned,
  type ArtifactWithLocations,
} from "../lib/backupsApi";
import { COPY_STATE_COPY, copyState, formatBytes, formatDateTime } from "../lib/presentation";
import type { InspectionResult } from "@/lib/backup/inspect";

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
  onClose,
  onChanged,
}: {
  artifact: ArtifactWithLocations;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
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
  const contents = (artifact.verification?.data.content ?? {}) as Record<string, number | string>;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      {/* The width has to be set through the same variant the sheet's own base
          class uses (`data-[side=right]:sm:max-w-sm`). A plain `sm:max-w-*`
          loses to it on specificity and is dropped by tailwind-merge, so it
          looks applied and does nothing. */}
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-[38rem]">
        <SheetHeader>
          <SheetTitle>
            {artifact.kind === "budget" ? artifact.sourceBudgetName ?? "Budget" : "Bench settings"}
          </SheetTitle>
          <SheetDescription>{formatDateTime(artifact.createdAt)}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={state === "verified" ? "status-active" : state === "unverified" ? "secondary" : "destructive"}>
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
              <h3 className="text-sm font-semibold text-destructive">What Bench found</h3>
              <ul className="space-y-1">
                {findings.slice(0, 8).map((finding) => (
                  <li key={finding} className="text-destructive">
                    {finding}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {artifact.encrypted && (
            <label className="block space-y-1">
              <span className="text-sm font-semibold">Passphrase</span>
              <Input
                className="h-8 rounded-md px-2 text-xs md:text-xs"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder="only needed if Bench has not stored it"
                autoComplete="new-password"
              />
            </label>
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
                    Restore it onto a server with a different{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
                      SYNC_VAULT_KEY
                    </code>{" "}
                    and you get every rule back but none of the stored credentials - Bench will ask
                    you to enter them again.
                  </p>
                </>
              )}

              {artifact.encrypted && (
                <p>
                  This copy is encrypted. Decrypt it before restoring - it carries its own salt, IV
                  and tag, so the passphrase is all you need. The recovery sheet documents the
                  format.
                </p>
              )}
            </div>

            {/* The checksum is for comparing against, so it gets a block of its
                own rather than being run into a sentence: 64 hex characters
                wrapped mid-paragraph are unreadable and unselectable. */}
            <div className="space-y-1 pt-1">
              <div className="text-xs text-muted-foreground">
                SHA-256 of the {artifact.encrypted ? "archive inside" : "file"}
              </div>
              <code className="block rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed break-all text-foreground/80">
                {artifact.plaintextChecksumSha256 ?? artifact.checksumSha256}
              </code>
              <p className="text-xs text-muted-foreground">
                Compare it with <code className="font-mono">sha256sum</code> on the downloaded file
                to prove nothing changed on the way here.
              </p>
            </div>
          </section>
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
