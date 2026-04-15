"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type DoneAction = "down" | "up" | "tab" | "shiftTab" | "cancel" | "blur";

type EditableCellInputProps = {
  initialValue: string;
  startChar?: string;
  onDone: (value: string, action: DoneAction) => void;
  className?: string;
  allowEmpty?: boolean;
  trimOnCommit?: boolean;
  selectOnFocus?: boolean;
};

/**
 * Shared inline text editor for table cells.
 *
 * Uses an uncontrolled input to keep typing work out of React and focuses
 * synchronously on mount so edit mode feels immediate in large tables.
 */
export function EditableCellInput({
  initialValue,
  startChar,
  onDone,
  className,
  allowEmpty = false,
  trimOnCommit = false,
  selectOnFocus = true,
}: EditableCellInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const composingRef = useRef(false);
  const initialDraft = startChar ?? initialValue;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.focus();

    if (startChar === undefined && selectOnFocus) {
      input.select();
      return;
    }

    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  }, [selectOnFocus, startChar]);

  function finish(action: DoneAction) {
    if (committedRef.current) return;

    const nextValue = inputRef.current?.value ?? initialDraft;
    const normalized = trimOnCommit ? nextValue.trim() : nextValue;

    if (action !== "cancel" && !allowEmpty && normalized.trim() === "") {
      committedRef.current = true;
      onDone(initialValue, "cancel");
      return;
    }

    committedRef.current = true;
    onDone(normalized, action);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();

    if (composingRef.current || e.nativeEvent.isComposing) return;

    if (e.key === "Enter") {
      e.preventDefault();
      finish("down");
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish("cancel");
    } else if (e.key === "Tab") {
      e.preventDefault();
      finish(e.shiftKey ? "shiftTab" : "tab");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      finish("down");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      finish("up");
    }
  }

  return (
    <input
      ref={inputRef}
      defaultValue={initialDraft}
      onBlur={() => finish("blur")}
      onKeyDown={handleKeyDown}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
      }}
      className={cn(
        "w-full min-w-0 border-0 bg-transparent p-0 text-sm leading-6 outline-none",
        className
      )}
    />
  );
}
