import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { EntityNoteButton } from "./entity-note-button";

jest.mock("../../hooks/useEntityNote", () => ({
  useEntityNote: jest.fn(),
}));

jest.mock("@base-ui/react/preview-card", () => {
  const React = jest.requireActual("react") as typeof import("react");

  type PreviewContextValue = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };

  const PreviewContext = React.createContext<PreviewContextValue>({
    open: false,
    onOpenChange: () => {},
  });

  return {
    PreviewCard: {
      Root: ({
        open,
        onOpenChange,
        children,
      }: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        children: React.ReactNode;
      }) => (
        <PreviewContext.Provider value={{ open, onOpenChange }}>
          {children}
        </PreviewContext.Provider>
      ),
      Trigger: ({
        children,
        render,
        onMouseEnter,
        onFocus,
        onMouseDown,
        onClick,
        ...props
      }: {
        children: React.ReactNode;
        render: React.ReactElement;
        onMouseEnter?: React.MouseEventHandler;
        onFocus?: React.FocusEventHandler;
        onMouseDown?: React.MouseEventHandler;
        onClick?: React.MouseEventHandler;
      }) => {
        const ctx = React.useContext(PreviewContext);
        return React.cloneElement(
          render as React.ReactElement<Record<string, unknown>>,
          {
            ...props,
            onMouseEnter: (e: React.MouseEvent) => {
              onMouseEnter?.(e);
              ctx.onOpenChange(true);
            },
            onFocus: (e: React.FocusEvent) => {
              onFocus?.(e);
              ctx.onOpenChange(true);
            },
            onMouseDown,
            onClick,
          },
          children
        );
      },
      Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      Positioner: ({
        children,
        className,
      }: {
        children: React.ReactNode;
        className?: string;
      }) => <div className={className}>{children}</div>,
      Popup: ({
        children,
        className,
      }: {
        children: React.ReactNode;
        className?: string;
      }) => {
        const ctx = React.useContext(PreviewContext);
        if (!ctx.open) return null;
        return <div className={className}>{children}</div>;
      },
    },
  };
});

const mockUseEntityNote = jest.requireMock(
  "../../hooks/useEntityNote"
).useEntityNote as jest.Mock;

describe("EntityNoteButton", () => {
  beforeEach(() => {
    mockUseEntityNote.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows a markdown preview after a short hover delay", () => {
    jest.useFakeTimers();

    mockUseEntityNote.mockReturnValue({
      data: "# Preview Title\n\n1. First\n   - Nested",
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(
      <EntityNoteButton
        entityId="acc-1"
        entityKind="account"
        entityLabel="Checking"
        entityTypeLabel="Account"
      />
    );

    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Preview note for Account Checking" })
    );

    expect(screen.queryByText("Note Preview")).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(349);
    });
    expect(screen.queryByText("Note Preview")).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(screen.getByText("Note Preview")).toBeInTheDocument();
    expect(screen.getByText("Preview Title")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Nested")).toBeInTheDocument();
  });

  it("pins the preview open on click and renders markdown content", () => {
    mockUseEntityNote.mockReturnValue({
      data: "## Full View\n\n__bold__ and _soft_",
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(
      <EntityNoteButton
        entityId="cat-1"
        entityKind="category"
        entityLabel="Groceries"
        entityTypeLabel="Category"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Preview note for Category Groceries" })
    );

    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("Full View")).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
    expect(screen.getByText("soft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("immediately closes the first pinned popover when another note is opened", () => {
    mockUseEntityNote.mockImplementation((kind: string, id: string) => ({
      data: `# ${kind}:${id}`,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    }));

    render(
      <>
        <EntityNoteButton
          entityId="acc-1"
          entityKind="account"
          entityLabel="Checking"
          entityTypeLabel="Account"
        />
        <EntityNoteButton
          entityId="acc-2"
          entityKind="account"
          entityLabel="Savings"
          entityTypeLabel="Account"
        />
      </>
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Preview note for Account Checking" })
    );
    expect(screen.getByText("account:acc-1")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Preview note for Account Savings" })
    );

    expect(screen.queryByText("account:acc-1")).not.toBeInTheDocument();
    expect(screen.getByText("account:acc-2")).toBeInTheDocument();
  });

  it("transfers the active preview when hovering another note", () => {
    jest.useFakeTimers();

    mockUseEntityNote.mockImplementation((kind: string, id: string) => ({
      data: `# ${kind}:${id}`,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    }));

    render(
      <>
        <EntityNoteButton
          entityId="acc-1"
          entityKind="account"
          entityLabel="Checking"
          entityTypeLabel="Account"
        />
        <EntityNoteButton
          entityId="acc-2"
          entityKind="account"
          entityLabel="Savings"
          entityTypeLabel="Account"
        />
      </>
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Preview note for Account Checking" })
    );
    expect(screen.getByText("account:acc-1")).toBeInTheDocument();

    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Preview note for Account Savings" })
    );

    expect(screen.queryByText("account:acc-1")).not.toBeInTheDocument();
    expect(screen.queryByText("account:acc-2")).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(349);
    });

    expect(screen.queryByText("account:acc-2")).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(screen.queryByText("account:acc-1")).not.toBeInTheDocument();
    expect(screen.getByText("account:acc-2")).toBeInTheDocument();
    expect(screen.getByText("Note Preview")).toBeInTheDocument();
  });
});
