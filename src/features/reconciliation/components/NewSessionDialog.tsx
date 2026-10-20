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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccountPicker } from "@/components/ui/entity-picker";
import type { Account, AccountGroup } from "@/types/entities";

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
  /** Open accounts only: a statement cannot be reconciled against a closed one. */
  accounts: Account[];
  accountGroups: AccountGroup[];
  /** Tags already used, offered as suggestions so they stay consistent. */
  knownTags: string[];
  isCreating: boolean;
  /**
   * Whether an account is a credit card in Credit Cards: registered (its statement figures can be entered),
   * a credit-card account not added there yet, or not a card at all (null).
   */
  cardStatus?: (accountId: string) => "registered" | "unregistered" | null;
  onStart: (accountId: string, tag: string | null, enterCardFigures: boolean) => void;
};

export function NewSessionDialog({
  open,
  onOpenChange,
  accounts,
  accountGroups,
  knownTags,
  isCreating,
  cardStatus,
  onStart,
}: NewSessionDialogProps) {
  const [accountId, setAccountId] = useState("");
  const [tag, setTag] = useState("");
  const [cardFigures, setCardFigures] = useState(false);
  const card = accountId && cardStatus ? cardStatus(accountId) : null;

  // Cleared on the way out rather than on the way in: reopening should not
  // silently reuse the previous choice, and resetting from an effect would
  // render once with the stale value still showing.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setAccountId("");
      setTag("");
      setCardFigures(false);
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

        {/*
          A form so Enter and the Start button are one path rather than two
          that can drift. `contents` keeps the dialog's own layout: a wrapper
          that laid itself out would make the fields one grid item between the
          header and the footer.

          The account list handles Enter itself - it picks the highlighted
          option and stops there - so pressing Enter to choose an account never
          also starts the reconciliation.
        */}
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (!accountId || isCreating) return;
            onStart(accountId, tag.trim() || null, card === "registered" && cardFigures);
          }}
        >
        <div className="flex flex-col gap-1.5">
          {/* The combobox renders a button, not an input with an id, so the
              visible label cannot point at it. It carries its own name. */}
          <Label className="text-xs">Account</Label>
          <AccountPicker
            accounts={accounts}
            groups={accountGroups}
            value={accountId}
            onChange={(id) => { setAccountId(id); setCardFigures(false); }}
            ariaLabel="Account"
            autoFocus
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

        {/* A credit card's statement is open now, so its bank figures can be entered before the import. */}
        {card && <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Checkbox id="reconciliation-card-figures" checked={card === "registered" && cardFigures}
              disabled={card !== "registered"} onCheckedChange={(checked) => setCardFigures(checked === true)} />
            <Label htmlFor="reconciliation-card-figures" className="text-xs">Also enter this card&apos;s bank statement figures</Label>
          </div>
          <p className="pl-6 text-[11px] text-muted-foreground">
            {card === "registered"
              ? "After you apply this reconciliation, review the statement in Credit Cards to match its transactions."
              : "Add this card in Credit Cards first."}
          </p>
        </div>}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!accountId || isCreating}>
            {isCreating ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
