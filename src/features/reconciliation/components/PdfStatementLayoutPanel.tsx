"use client";

import { useState } from "react";
import { AlertTriangle, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectField } from "@/components/ui/select-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { PdfDetectionProfileOption } from "./PdfStatementReviewDialog";

/**
 * Statement layouts live with the detection settings they describe, not in the
 * workbench toolbar: choosing, saving, and assigning one are all answers to
 * "how is this statement read", which is what the right-hand panel is for.
 */
export function PdfStatementLayoutPanel({
  profiles,
  selectedProfileId,
  accountProfileId,
  accountName,
  notice,
  disabled,
  canSave,
  saveBlockedReason,
  onSelect,
  onAssign,
  onManage,
  onSave,
}: {
  profiles: PdfDetectionProfileOption[];
  selectedProfileId: string | null;
  accountProfileId: string | null;
  accountName: string;
  notice: string | null;
  disabled: boolean;
  canSave: boolean;
  saveBlockedReason: string | null;
  onSelect: (recordId: string) => void;
  onAssign?: () => void;
  onManage?: () => void;
  onSave?: () => void;
}) {
  const selected = profiles.find((profile) => profile.recordId === selectedProfileId) ?? null;
  const isAccountLayout = Boolean(selected) && selected?.recordId === accountProfileId;
  const byBank = profiles.reduce<Map<string, PdfDetectionProfileOption[]>>((groups, profile) => {
    groups.set(profile.bankName, [...(groups.get(profile.bankName) ?? []), profile]);
    return groups;
  }, new Map());

  return (
    <section aria-labelledby="pdf-statement-layout-heading" className="rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="pdf-statement-layout-heading" className="text-sm font-medium">Statement layout</h3>
        {onManage && (
          <Button size="xs" variant="ghost" disabled={disabled} onClick={onManage}>
            <Settings2 aria-hidden="true" className="mr-1 size-3.5" />Manage
          </Button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor="pdf-statement-layout" className="sr-only">Use layout</label>
        <SelectField
          id="pdf-statement-layout"
          value={selectedProfileId ?? ""}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value)}
          className="min-w-48 flex-1 text-xs"
        >
          <option value="">Automatic detection</option>
          {[...byBank.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([bankName, bankProfiles]) => (
              <optgroup key={bankName} label={bankName}>
                {[...bankProfiles]
                  .sort((left, right) => left.envelope.profile.name.localeCompare(right.envelope.profile.name))
                  .map((profile) => (
                    <option key={profile.recordId} value={profile.recordId}>{profile.envelope.profile.name}</option>
                  ))}
              </optgroup>
            ))}
        </SelectField>
        {onSave && (
          <Button
            size="xs"
            variant="outline"
            disabled={disabled || !canSave}
            title={saveBlockedReason ?? undefined}
            onClick={onSave}
          >
            <Save aria-hidden="true" className="mr-1 size-3.5" />Save layout
          </Button>
        )}
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {selected
          ? isAccountLayout
            ? `${selected.bankName} · assigned to ${accountName}`
            : `${selected.bankName} · used for this statement only`
          : "Detected from this statement only. Save a layout to reuse it next month."}
      </p>

      {selected && !isAccountLayout && onAssign && (
        <Button className="mt-1.5" size="xs" variant="ghost" disabled={disabled} onClick={onAssign}>
          Use for {accountName}
        </Button>
      )}

      {notice && (
        <p className={cn("mt-2 flex items-start gap-1.5 text-[11px]", "text-amber-700 dark:text-amber-300")}>
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{notice}</span>
        </p>
      )}
    </section>
  );
}

export type PdfLayoutSaveRequest = {
  bankName: string;
  profileName: string;
  mode: "create" | "update";
  assignToAccount: boolean;
};

/**
 * Saving asks one question when the name is taken: replace that layout, or
 * keep it and save this one under a new name. There is no version history to
 * reason about afterwards.
 */
export function PdfLayoutSaveDialog({
  open,
  onOpenChange,
  profiles,
  initialBankName,
  initialProfileName,
  accountName,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: PdfDetectionProfileOption[];
  initialBankName: string;
  initialProfileName: string;
  accountName: string;
  isSaving: boolean;
  onSave: (input: PdfLayoutSaveRequest) => Promise<void>;
}) {
  const [bankName, setBankName] = useState(initialBankName);
  const [profileName, setProfileName] = useState(initialProfileName);
  const [assignToAccount, setAssignToAccount] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(true);

  const banks = [...new Set(profiles.map((profile) => profile.bankName))];
  const matching = profiles.find((profile) =>
    profile.bankName.localeCompare(bankName.trim(), undefined, { sensitivity: "accent" }) === 0
    && profile.envelope.profile.name.localeCompare(profileName.trim(), undefined, { sensitivity: "accent" }) === 0);
  const nameTaken = Boolean(matching);
  const mode: "create" | "update" = nameTaken && replaceExisting ? "update" : "create";
  const valid = Boolean(bankName.trim() && profileName.trim()) && (!nameTaken || replaceExisting);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save statement layout</DialogTitle>
          <DialogDescription>
            Layouts are shared across budgets and accounts. They store detection settings only, not statement data.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Bank</span>
            <Input
              list="pdf-statement-layout-banks"
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              placeholder="For example, HSBC Bank"
              className="h-9"
              autoFocus
            />
            <datalist id="pdf-statement-layout-banks">
              {banks.map((bank) => <option key={bank} value={bank} />)}
            </datalist>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Layout name</span>
            <Input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="For example, Credit card"
              className="h-9"
            />
          </label>

          {nameTaken && (
            <fieldset className="grid gap-2 rounded-md border px-3 py-2 text-sm">
              <legend className="px-1 text-xs font-medium">{bankName.trim()} already has this layout</legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="pdf-layout-save-mode"
                  className="mt-1"
                  checked={replaceExisting}
                  onChange={() => setReplaceExisting(true)}
                />
                <span>
                  <span className="font-medium">Update {profileName.trim()}</span>
                  <span className="block text-xs text-muted-foreground">Replaces its detection settings with the current ones.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="pdf-layout-save-mode"
                  className="mt-1"
                  checked={!replaceExisting}
                  onChange={() => setReplaceExisting(false)}
                />
                <span>
                  <span className="font-medium">Keep it and save a new layout</span>
                  <span className="block text-xs text-muted-foreground">Enter a different name above.</span>
                </span>
              </label>
            </fieldset>
          )}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={assignToAccount}
              onCheckedChange={(checked) => setAssignToAccount(checked === true)}
            />
            Use this layout for {accountName}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={isSaving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!valid || isSaving}
            onClick={() => void onSave({
              bankName: bankName.trim(),
              profileName: profileName.trim(),
              mode,
              assignToAccount,
            })}
          >
            {isSaving ? "Saving…" : mode === "update" ? "Update layout" : "Save layout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
