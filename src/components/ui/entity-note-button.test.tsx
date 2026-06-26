import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { EntityNoteButton } from "./entity-note-button";

jest.mock("../../hooks/useAllNotes", () => ({
  useAllNotes: jest.fn(),
}));

jest.mock("../../hooks/useNoteMutation", () => ({
  useNoteMutation: jest.fn(),
}));

// Minimal controlled stand-in for the base-ui Popover parts our wrapper uses.
jest.mock("@base-ui/react/popover", () => {
  const React = jest.requireActual("react") as typeof import("react");

  type Ctx = { open: boolean; onOpenChange: (open: boolean) => void };
  const PopoverContext = React.createContext<Ctx>({
    open: false,
    onOpenChange: () => {},
  });

  return {
    Popover: {
      Root: ({
        open,
        onOpenChange,
        children,
      }: {
        open?: boolean;
        onOpenChange?: (open: boolean) => void;
        children: React.ReactNode;
      }) => (
        <PopoverContext.Provider
          value={{ open: !!open, onOpenChange: onOpenChange ?? (() => {}) }}
        >
          {children}
        </PopoverContext.Provider>
      ),
      Trigger: ({
        render,
        children,
        onClick,
        onMouseDown,
        ...props
      }: {
        render: React.ReactElement;
        children: React.ReactNode;
        onClick?: React.MouseEventHandler;
        onMouseDown?: React.MouseEventHandler;
      }) => {
        const ctx = React.useContext(PopoverContext);
        return React.cloneElement(
          render as React.ReactElement<Record<string, unknown>>,
          {
            ...props,
            onMouseDown,
            onClick: (e: React.MouseEvent) => {
              onClick?.(e);
              ctx.onOpenChange(!ctx.open);
            },
          },
          children
        );
      },
      Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      Positioner: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Popup: ({ children }: { children: React.ReactNode }) => {
        const ctx = React.useContext(PopoverContext);
        if (!ctx.open) return null;
        return <div>{children}</div>;
      },
    },
  };
});

const mockUseAllNotes = jest.requireMock("../../hooks/useAllNotes")
  .useAllNotes as jest.Mock;
const mockUseNoteMutation = jest.requireMock("../../hooks/useNoteMutation")
  .useNoteMutation as jest.Mock;

const saveMutate = jest.fn();
const removeMutate = jest.fn();

function setNote(value: string | undefined, isSuccess: boolean) {
  // The popover reads from the batched all-notes map; the default entity in
  // these tests is account/acc-1, whose notes-table key is `account-acc-1`.
  const data = new Map<string, string>();
  if (value) data.set("account-acc-1", value);
  mockUseAllNotes.mockReturnValue({
    data: isSuccess ? data : undefined,
    isLoading: false,
    isError: false,
    isSuccess,
    refetch: jest.fn(),
  });
}

beforeEach(() => {
  mockUseAllNotes.mockReset();
  mockUseNoteMutation.mockReset();
  saveMutate.mockReset();
  removeMutate.mockReset();
  mockUseNoteMutation.mockReturnValue({
    save: { mutate: saveMutate, reset: jest.fn(), isPending: false, isError: false },
    remove: { mutate: removeMutate, reset: jest.fn(), isPending: false, isError: false },
  });
});

function renderButton(props: Partial<React.ComponentProps<typeof EntityNoteButton>> = {}) {
  return render(
    <EntityNoteButton
      entityId="acc-1"
      entityKind="account"
      entityLabel="Checking"
      entityTypeLabel="Account"
      {...props}
    />
  );
}

describe("EntityNoteButton", () => {
  it("labels the trigger 'Add note' when the entity has no note", () => {
    setNote(undefined, false);
    renderButton({ hasNote: false });
    expect(
      screen.getByRole("button", { name: "Add note for Account Checking" })
    ).toBeInTheDocument();
  });

  it("labels the trigger 'Edit note' when the entity already has a note", () => {
    setNote(undefined, false);
    renderButton({ hasNote: true });
    expect(
      screen.getByRole("button", { name: "Edit note for Account Checking" })
    ).toBeInTheDocument();
  });

  it("opens an empty note straight into edit mode and saves the draft", () => {
    setNote("", true);
    renderButton({ hasNote: false });

    fireEvent.click(
      screen.getByRole("button", { name: "Add note for Account Checking" })
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "Pays on the 1st" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(saveMutate).toHaveBeenCalledWith(
      "Pays on the 1st",
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("does not fire a save or delete when a brand-new note is left blank", () => {
    setNote("", true);
    renderButton({ hasNote: false });

    fireEvent.click(
      screen.getByRole("button", { name: "Add note for Account Checking" })
    );

    // Whitespace-only draft on a note that never existed: Save is enabled (the
    // draft differs from the empty stored value) but must not issue a DELETE for
    // a missing note — it just closes.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(saveMutate).not.toHaveBeenCalled();
    expect(removeMutate).not.toHaveBeenCalled();
  });

  it("renders markdown in read mode and switches to edit on Edit", () => {
    setNote("## Heading\n\n__bold__", true);
    renderButton({ hasNote: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Edit note for Account Checking" })
    );

    expect(screen.getByText("Heading")).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toHaveValue("## Heading\n\n__bold__");
  });

  it("clears an existing note via the Clear action", () => {
    setNote("Some note", true);
    renderButton({ hasNote: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Edit note for Account Checking" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(removeMutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("disables Save until the draft changes", () => {
    setNote("Original", true);
    renderButton({ hasNote: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Edit note for Account Checking" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Original + more" },
    });
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });
});
