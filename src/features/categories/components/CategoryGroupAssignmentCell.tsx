"use client";

import React, { useState } from "react";
import { CategoryGroupPicker } from "@/components/ui/entity-picker";

export type CategoryGroupOption = { id: string; name: string };

export const CategoryGroupAssignmentCell = React.memo(
  function CategoryGroupAssignmentCell({
    categoryId,
    groupId,
    currentLabel,
    disabled,
    disabledTitle,
    options,
    onCommit,
  }: {
    categoryId: string;
    groupId: string;
    currentLabel: string;
    disabled: boolean;
    disabledTitle?: string;
    options: CategoryGroupOption[];
    onCommit: (categoryId: string, nextGroupId: string) => void;
  }) {
    const [isEditing, setIsEditing] = useState(false);

    if (disabled) {
      return (
        <span className="text-xs text-muted-foreground" title={disabledTitle}>
          {currentLabel}
        </span>
      );
    }

    if (!isEditing) {
      return (
        <button
          type="button"
          className="flex h-6 w-full items-center rounded border border-transparent bg-background px-1.5 text-left text-xs text-foreground hover:border-border hover:bg-muted/20"
          onClick={() => setIsEditing(true)}
          title={`Move to ${currentLabel}`}
        >
          <span className="truncate">{currentLabel}</span>
        </button>
      );
    }

    return (
      <CategoryGroupPicker
        autoFocus
        size="sm"
        className="h-6"
        ariaLabel="Category group"
        groups={options}
        value={groupId}
        onOpenChange={(open) => {
          if (!open) setIsEditing(false);
        }}
        onChange={(nextGroupId) => {
          if (nextGroupId !== groupId) {
            onCommit(categoryId, nextGroupId);
          }
          setIsEditing(false);
        }}
      />
    );
  },
  (prev, next) =>
    prev.categoryId === next.categoryId &&
    prev.groupId === next.groupId &&
    prev.currentLabel === next.currentLabel &&
    prev.disabled === next.disabled &&
    prev.disabledTitle === next.disabledTitle &&
    prev.options === next.options
);
