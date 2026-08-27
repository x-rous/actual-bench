"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Minus } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { createDestination, inspectPath, patchDestination, testDestination } from "../lib/backupsApi";
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import type { DestinationCheck } from "@/lib/backup/destinations/types";

/**
 * Adding a place for backups to go (RD-077 / PR-047e).
 *
 * Two kinds, presented as the two situations people are actually in rather than
 * as a list of storage technologies: a folder on this server (which covers
 * every mounted volume and NAS share), or a bucket somewhere else.
 *
 * The dialog checks the path *while it is being typed*, not when the backup
 * runs at 3am. That is most of its value: it will tell you the directory does
 * not exist and offer to create it, that Bench cannot write there, that the
 * volume is nearly full, or that this folder is on the same disk as Bench's own
 * data — which is a warning rather than a refusal, because `/data/backups` is a
 * legitimate and common arrangement that simply is not off-site.
 */

const inputClass = "h-8 rounded-md px-2 text-xs md:text-xs";
const selectClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: BackupDestination | null;
  onSaved: () => void;
};

export function DestinationDialog({ open, onOpenChange, existing, onSaved }: Props) {
  const editing = Boolean(existing);
  const [kind, setKind] = useState<"local" | "s3">(existing?.kind ?? "local");
  const [name, setName] = useState(existing?.name ?? "");

  const config = (existing?.config.data ?? {}) as Record<string, unknown>;
  const [path, setPath] = useState(String(config.path ?? "/data/backups"));
  const [bucket, setBucket] = useState(String(config.bucket ?? ""));
  const [region, setRegion] = useState(String(config.region ?? "us-east-1"));
  const [endpoint, setEndpoint] = useState(String(config.endpoint ?? ""));
  const [prefix, setPrefix] = useState(String(config.prefix ?? "actual-bench"));
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");

  const [checks, setChecks] = useState<DestinationCheck[] | null>(null);

  const check = useMutation({
    mutationFn: () => inspectPath(path),
    onSuccess: (result) => setChecks(result.checks),
    onError: (error: Error) => toast.error(error.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload =
        kind === "local"
          ? { name, kind, config: { version: 1, data: { path: path.trim() } } }
          : {
              name,
              kind,
              config: {
                version: 1,
                data: {
                  bucket: bucket.trim(),
                  region: region.trim(),
                  endpoint: endpoint.trim() || null,
                  prefix: prefix.trim(),
                },
              },
              ...(accessKeyId && secretAccessKey
                ? { credentials: { accessKeyId, secretAccessKey } }
                : {}),
            };

      const destination = existing
        ? await patchDestination(existing.id, payload)
        : await createDestination(payload);

      // Test on save, always. A destination that has never been written to is a
      // guess, and the moment to find that out is now rather than at 2am.
      const result = await testDestination(destination.id);
      return { destination, result };
    },
    onSuccess: ({ result }) => {
      setChecks(result.checks);
      if (result.ok) {
        toast.success(
          editing ? "Destination updated and tested" : "Destination added — Bench wrote a test file and read it back"
        );
        onSaved();
        onOpenChange(false);
      } else {
        // Saved, but not working. Keep the dialog open with the reason: closing
        // it would leave a destination that looks configured and is not.
        toast.warning("Saved, but the test failed. See the checks below.");
        onSaved();
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canSave =
    name.trim().length > 0 &&
    (kind === "local"
      ? path.trim().length > 0
      : bucket.trim().length > 0 && (editing || (accessKeyId && secretAccessKey)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit destination" : "Add a destination"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <Field label="Name">
            <Input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={kind === "local" ? "NAS volume" : "Off-site bucket"}
            />
          </Field>

          {!editing && (
            <Field label="Kind">
              <select
                className={selectClass}
                value={kind}
                onChange={(event) => setKind(event.target.value as "local" | "s3")}
              >
                <option value="local">A folder on this server</option>
                <option value="s3">An S3-compatible bucket</option>
              </select>
            </Field>
          )}

          {kind === "local" ? (
            <>
              <Field label="Folder">
                <div className="flex gap-2">
                  <Input
                    className={inputClass}
                    value={path}
                    onChange={(event) => {
                      setPath(event.target.value);
                      setChecks(null);
                    }}
                    placeholder="/data/backups"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => check.mutate()}
                    disabled={check.isPending || !path.trim()}
                  >
                    {check.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    Check
                  </Button>
                </div>
              </Field>
              <p className="text-muted-foreground">
                Any absolute path the server can write to — a mounted volume, a NAS share, a second
                disk. Bench creates it if it does not exist.
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Bucket">
                  <Input className={inputClass} value={bucket} onChange={(e) => setBucket(e.target.value)} />
                </Field>
                <Field label="Region">
                  <Input className={inputClass} value={region} onChange={(e) => setRegion(e.target.value)} />
                </Field>
              </div>
              <Field label="Endpoint (leave blank for AWS)">
                <Input
                  className={inputClass}
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://minio.lan:9000"
                />
              </Field>
              <Field label="Prefix">
                <Input className={inputClass} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Access key ID">
                  <Input
                    className={inputClass}
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    placeholder={editing ? "unchanged" : ""}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Secret access key">
                  <Input
                    className={inputClass}
                    type="password"
                    value={secretAccessKey}
                    onChange={(e) => setSecretAccessKey(e.target.value)}
                    placeholder={editing ? "unchanged" : ""}
                    autoComplete="new-password"
                  />
                </Field>
              </div>
              <p className="text-muted-foreground">
                Works with MinIO, Backblaze B2, Cloudflare R2, Wasabi and Garage as well as AWS. Keys
                are encrypted with your server&rsquo;s <code>SYNC_VAULT_KEY</code> and never stored in
                readable form.
              </p>
            </>
          )}

          {checks && checks.length > 0 && <ChecksList checks={checks} />}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {editing ? "Save and test" : "Add and test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

/** Checks are shown in full, pass and fail alike: a list of only problems makes
 * it impossible to tell "nothing was checked" from "everything was fine". */
function ChecksList({ checks }: { checks: DestinationCheck[] }) {
  return (
    <ul className="space-y-1 rounded-md border border-border p-2">
      {checks.map((check) => (
        <li key={check.name} className="flex items-start gap-2">
          {check.status === "pass" ? (
            <Check className="mt-0.5 size-3.5 shrink-0 text-green-600 dark:text-green-500" aria-hidden />
          ) : check.status === "warn" ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
          ) : (
            <Minus className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
          )}
          <span
            className={cn(
              "min-w-0",
              check.status === "fail" && "text-destructive",
              check.status === "warn" && "text-amber-700 dark:text-amber-400"
            )}
          >
            <span className="font-medium">{check.name}: </span>
            {check.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}
