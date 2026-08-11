"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/combobox";

/**
 * Picking the account to reconcile.
 *
 * A plain `<select>` is fine with six accounts and unusable with sixty — which
 * is the situation for anyone with the card, savings, and joint accounts this
 * feature exists to check. The combobox is searchable for that reason.
 *
 * Kept as a dialog rather than a control parked in the toolbar: starting a
 * reconciliation is an action, and the page's toolbar should read as the other
 * list pages do — the page's name, and the things you can do to it.
 */

export type NewSessionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { id: string; name: string }[];
  /** Tags already used, offered as suggestions so they stay consistent. */
  knownTags: string[];
  isCreating: boolean;
  onStart: (accountId: string, tag: string | null) => void;
};

export function NewSessionDialog({
  open,
  onOpenChange,
  accounts,
  knownTags,
  isCreating,
  onStart,
}: NewSessionDialogProps) {
  const [accountId, setAccountId] = useState("");
  const [tag, setTag] = useState("");

  // Cleared on the way out rather than on the way in: reopening should not
  // silently reuse the previous choice, and resetting from an effect would
  // render once with the stale value still showing.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setAccountId("");
      setTag("");
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New reconciliation</DialogTitle>
          <DialogDescription>
            Choose the account whose statement you want to check. Nothing is written to your budget
            until you review and apply.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reconciliation-account" className="text-xs">
            Account
          </Label>
          <SearchableCombobox
            options={accounts}
            value={accountId}
            onChange={setAccountId}
            placeholder="Select an account…"
          />
        </div>

        {/*
          Optional, and asked here because this is the only moment the user
          knows what the session is *for*. Free text with suggestions rather
          than a managed list: these labels are disposable — "July close",
          "after the refund" — and are not the budget's own tags.
        */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reconciliation-tag" className="text-xs">
            Tag <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="reconciliation-tag"
            list="reconciliation-tag-suggestions"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="July close"
            maxLength={40}
            className="h-8 text-xs"
          />
          {knownTags.length > 0 && (
            <datalist id="reconciliation-tag-suggestions">
              {knownTags.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          )}
          <p className="text-[11px] text-muted-foreground">
            Helps tell this month&apos;s reruns and corrections apart in the list.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!accountId || isCreating}
            onClick={() => onStart(accountId, tag.trim() || null)}
          >
            {isCreating ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
