"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PdfDetectionBankRecord } from "../lib/reconciliationApi";
import type { PdfDetectionProfileOption } from "./PdfStatementReviewDialog";

type Editing = { kind: "bank" | "profile"; id: string; value: string } | null;

export function PdfDetectionProfileManagerDialog({
  open,
  onOpenChange,
  accountName,
  banks,
  profiles,
  accountProfileId,
  onAssign,
  onRemoveAssignment,
  onRenameBank,
  onRenameProfile,
  onDeleteProfile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountName: string;
  banks: PdfDetectionBankRecord[];
  profiles: PdfDetectionProfileOption[];
  accountProfileId: string | null;
  onAssign: (profileId: string) => Promise<unknown>;
  onRemoveAssignment: () => Promise<unknown>;
  onRenameBank: (bankId: string, name: string) => Promise<unknown>;
  onRenameProfile: (profileId: string, name: string) => Promise<unknown>;
  onDeleteProfile: (profileId: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const grouped = useMemo(() => banks.map((bank) => ({
    bank,
    profiles: profiles.filter((profile) => profile.bankId === bank.id),
  })), [banks, profiles]);
  const assignedProfile = profiles.find((profile) => profile.recordId === accountProfileId);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement layout change could not be saved.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit() {
    if (!editing?.value.trim()) return;
    const current = editing;
    const saved = await run(`rename-${current.id}`, () => current.kind === "bank"
      ? onRenameBank(current.id, current.value.trim())
      : onRenameProfile(current.id, current.value.trim()));
    if (saved) setEditing(null);
  }

  const assignment = assignedProfile
    ? `${assignedProfile.bankName} · ${assignedProfile.envelope.profile.name}`
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage statement layouts</DialogTitle>
            <DialogDescription>
              Layouts are global. Account assignments are specific to this budget file and account.
            </DialogDescription>
          </DialogHeader>

          <section className="rounded-md border bg-muted/20 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{accountName}</span>
              <span className="text-muted-foreground">
                {assignment ? `uses ${assignment}` : "has no assigned statement layout"}
              </span>
              {assignment && (
                <Button
                  className="ml-auto"
                  size="xs"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void run("remove-assignment", onRemoveAssignment)}
                >
                  Remove assignment
                </Button>
              )}
            </div>
          </section>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {grouped.map(({ bank, profiles: bankProfiles }) => (
              <section key={bank.id} className="rounded-md border">
                <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2">
                  {editing?.kind === "bank" && editing.id === bank.id ? (
                    <>
                      <Input
                        aria-label="Bank name"
                        value={editing.value}
                        onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveEdit();
                          if (event.key === "Escape") setEditing(null);
                        }}
                        autoFocus
                      />
                      <Button size="icon-xs" aria-label="Save bank name" disabled={!editing.value.trim() || busy !== null} onClick={() => void saveEdit()}><Check /></Button>
                    </>
                  ) : (
                    <>
                      <h3 className="font-medium">{bank.name}</h3>
                      <Button size="icon-xs" variant="ghost" aria-label={`Rename ${bank.name}`} disabled={busy !== null} onClick={() => setEditing({ kind: "bank", id: bank.id, value: bank.name })}><Pencil /></Button>
                    </>
                  )}
                </div>
                <div className="divide-y">
                  {bankProfiles.map((profile) => {
                    const isAssigned = accountProfileId === profile.recordId;
                    return (
                      <div key={profile.recordId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                        {editing?.kind === "profile" && editing.id === profile.recordId ? (
                          <>
                            <Input
                              aria-label="Layout name"
                              value={editing.value}
                              onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void saveEdit();
                                if (event.key === "Escape") setEditing(null);
                              }}
                              autoFocus
                            />
                            <Button size="icon-xs" aria-label="Save layout name" disabled={!editing.value.trim() || busy !== null} onClick={() => void saveEdit()}><Check /></Button>
                          </>
                        ) : (
                          <>
                            <span className="font-medium">{profile.envelope.profile.name}</span>
                            {isAssigned && <Badge variant="status-active">This account</Badge>}
                            <Button size="icon-xs" variant="ghost" aria-label={`Rename ${profile.envelope.profile.name}`} disabled={busy !== null} onClick={() => setEditing({ kind: "profile", id: profile.recordId, value: profile.envelope.profile.name })}><Pencil /></Button>
                          </>
                        )}
                        <div className="ml-auto flex items-center gap-1">
                          {!isAssigned && (
                            <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => void run(`assign-${profile.recordId}`, () => onAssign(profile.recordId))}>Use for this account</Button>
                          )}
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Delete ${profile.envelope.profile.name}`}
                            disabled={busy !== null}
                            onClick={() => setConfirm({
                              title: "Delete statement layout?",
                              message: bankProfiles.length === 1
                                ? `This will also remove ${bank.name} and any account assignments that use it.`
                                : `Delete ${profile.envelope.profile.name} from ${bank.name}? Account assignments that use it will be removed.`,
                              destructiveLabel: "Delete layout",
                              onConfirm: () => void run(`delete-${profile.recordId}`, () => onDeleteProfile(profile.recordId)),
                            })}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {banks.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No statement layouts have been saved.</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={confirm !== null} onOpenChange={(next) => { if (!next) setConfirm(null); }} state={confirm} />
    </>
  );
}
