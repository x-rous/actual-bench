"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
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
import { useStagedStore } from "@/store/staged";
import { useAccountGroupActions } from "../hooks/useAccountGroupActions";
import { GROUP_NAME_MAX, groupMemberCounts, liveGroups, validateGroupName } from "../lib/accountGroups";

/**
 * Create, rename and delete account groups. Every change is staged (undoable,
 * saved with the rest of the draft); nothing is written from this dialog.
 *
 * `assignAccountIds` is set when the dialog was opened from an account's
 * "New group…" choice: the group created here is assigned to those accounts.
 */
export function AccountGroupsDialog({
  open,
  onOpenChange,
  assignAccountIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignAccountIds?: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The body owns the form state; it unmounts with the dialog, so every open starts clean. */}
      <DialogContent className="sm:max-w-md">
        <GroupsDialogBody onOpenChange={onOpenChange} assignAccountIds={assignAccountIds} />
      </DialogContent>
    </Dialog>
  );
}

function GroupsDialogBody({
  onOpenChange,
  assignAccountIds,
}: {
  onOpenChange: (open: boolean) => void;
  assignAccountIds?: string[];
}) {
  const stagedGroups = useStagedStore((s) => s.accountGroups);
  const stagedAccounts = useStagedStore((s) => s.accounts);
  const { createGroup, renameGroup, deleteGroup } = useAccountGroupActions();

  const groups = useMemo(() => liveGroups(stagedGroups), [stagedGroups]);
  const counts = useMemo(() => groupMemberCounts(stagedAccounts), [stagedAccounts]);

  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  function handleCreate() {
    const result = createGroup(newName, assignAccountIds);
    if ("error" in result) {
      setNewError(result.error);
      return;
    }
    setNewName("");
    setNewError(null);
    // Opened from an account's "New group…": the point was to assign it, so close.
    if (assignAccountIds && assignAccountIds.length > 0) onOpenChange(false);
    else newInputRef.current?.focus();
  }

  function startEdit(id: string, name: string) {
    setEditingId(id);
    setEditName(name);
    setEditError(null);
    setConfirmDeleteId(null);
  }

  function commitEdit() {
    if (!editingId) return;
    const error = renameGroup(editingId, editName);
    if (error) {
      setEditError(error);
      return;
    }
    setEditingId(null);
    setEditError(null);
  }

  const newNameError = newName.trim() ? validateGroupName(newName, stagedGroups) : null;
  const assigning = (assignAccountIds?.length ?? 0) > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{assigning ? "New account group" : "Manage account groups"}</DialogTitle>
        <DialogDescription>
          {assigning
            ? "The new group is assigned to the selected account when you create it. Nothing is written until you Save."
            : "Groups organise accounts in Actual's sidebar. Changes are drafted and written when you Save."}
        </DialogDescription>
      </DialogHeader>

      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
      >
        <label htmlFor="new-account-group" className="text-xs font-medium">
          New group name
        </label>
        <div className="flex gap-2">
          <Input
            id="new-account-group"
            ref={newInputRef}
            autoFocus
            value={newName}
            maxLength={GROUP_NAME_MAX}
            aria-invalid={!!(newError ?? newNameError)}
            aria-describedby="new-account-group-error"
            onChange={(e) => {
              setNewName(e.target.value);
              setNewError(null);
            }}
            placeholder="e.g. Everyday banking"
          />
          <Button type="submit" size="sm" disabled={!newName.trim() || !!newNameError}>
            {assigning ? "Create and assign" : "Add"}
          </Button>
        </div>
        <p id="new-account-group-error" className="min-h-4 text-xs text-destructive" role="alert">
          {newError ?? newNameError}
        </p>
      </form>

      {!assigning && (
        <div className="max-h-72 overflow-auto rounded-md border border-border/60">
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No account groups yet.</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {groups.map((group) => {
                const isEditing = editingId === group.id;
                const memberCount = counts.get(group.id) ?? 0;
                const isNew = stagedGroups[group.id]?.isNew;
                const saveError = stagedGroups[group.id]?.saveError;
                return (
                  <li key={group.id} className="flex flex-col gap-1 px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <Input
                            size="sm"
                            autoFocus
                            value={editName}
                            maxLength={GROUP_NAME_MAX}
                            aria-label={`Rename group ${group.name}`}
                            aria-invalid={!!editError}
                            onChange={(e) => {
                              setEditName(e.target.value);
                              setEditError(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit();
                              if (e.key === "Escape") {
                                e.stopPropagation();
                                setEditingId(null);
                              }
                            }}
                          />
                          <Button size="icon-xs" variant="ghost" aria-label="Save name" onClick={commitEdit}>
                            <Check />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label="Cancel rename"
                            onClick={() => setEditingId(null)}
                          >
                            <X />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {group.name}
                            {isNew && <span className="ml-2 text-xs text-green-600 dark:text-green-400">new</span>}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {memberCount} account{memberCount === 1 ? "" : "s"}
                          </span>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Rename group ${group.name}`}
                            onClick={() => startEdit(group.id, group.name)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Delete group ${group.name}`}
                            onClick={() => setConfirmDeleteId(group.id)}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </div>
                    {isEditing && editError && (
                      <p className="text-xs text-destructive" role="alert">
                        {editError}
                      </p>
                    )}
                    {saveError && (
                      <p className="text-xs text-destructive" role="alert">
                        {saveError}
                      </p>
                    )}
                    {confirmDeleteId === group.id && (
                      <div className="flex items-center gap-2 rounded bg-destructive/5 px-2 py-1 text-xs">
                        <span className="flex-1">
                          {memberCount > 0
                            ? `Delete this group? Its ${memberCount} account${memberCount === 1 ? "" : "s"} will be kept and become ungrouped.`
                            : "Delete this empty group?"}
                        </span>
                        <Button
                          size="xs"
                          variant="destructive"
                          onClick={() => {
                            deleteGroup(group.id);
                            setConfirmDeleteId(null);
                          }}
                        >
                          Delete
                        </Button>
                        <Button size="xs" variant="outline" onClick={() => setConfirmDeleteId(null)}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {assigning ? "Cancel" : "Done"}
        </Button>
      </DialogFooter>
    </>
  );
}
