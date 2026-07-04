import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNoteMutation } from "./useNoteMutation";
import { toAccountNoteId } from "../lib/api/notes";

// Relative paths resolve to the same module the hook imports via `@/…`, so these
// mocks intercept it. Keep the real id helpers (the hook derives the cache key
// from them); only stub the network writers so we can assert on the DELETE.
jest.mock("../lib/api/notes", () => ({
  ...jest.requireActual("../lib/api/notes"),
  setAccountNote: jest.fn(() => Promise.resolve()),
  deleteAccountNote: jest.fn(() => Promise.resolve()),
}));

// Pin an active connection so the hook builds a stable cache key.
jest.mock("../store/connection", () => ({
  useConnectionStore: jest.fn(() => ({ id: "conn-1" })),
  selectActiveInstance: jest.fn(),
  isBrowserApiConnection: jest.fn((connection) => connection?.mode === "browser-api"),
}));

const notes = jest.requireMock("../lib/api/notes") as {
  setAccountNote: jest.Mock;
  deleteAccountNote: jest.Mock;
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderWithNotes(entries: Array<[string, string]>) {
  const client = new QueryClient();
  client.setQueryData(["allNotes", "conn-1"], new Map<string, string>(entries));
  return renderHook(() => useNoteMutation("account", "acc-1"), {
    wrapper: makeWrapper(client),
  });
}

function renderColdCache() {
  // The allNotes query is never populated, so getQueryState() is undefined.
  const client = new QueryClient();
  return renderHook(() => useNoteMutation("account", "acc-1"), {
    wrapper: makeWrapper(client),
  });
}

describe("useNoteMutation", () => {
  beforeEach(() => {
    notes.setAccountNote.mockClear();
    notes.deleteAccountNote.mockClear();
  });

  it("skips the DELETE when an empty save clears a note that never existed", async () => {
    const { result } = renderWithNotes([]); // nothing in the notes cache
    await act(async () => {
      // Whitespace-only content routes to the clear path; with no note present
      // it must resolve as a no-op rather than firing a DELETE (a possible 404).
      await result.current.save.mutateAsync("   ");
    });
    expect(notes.deleteAccountNote).not.toHaveBeenCalled();
    expect(notes.setAccountNote).not.toHaveBeenCalled();
  });

  it("sends the DELETE when clearing a note that exists", async () => {
    const { result } = renderWithNotes([[toAccountNoteId("acc-1"), "existing"]]);
    await act(async () => {
      await result.current.remove.mutateAsync();
    });
    expect(notes.deleteAccountNote).toHaveBeenCalledWith({ id: "conn-1" }, "acc-1");
  });

  it("sends the DELETE when the notes cache is cold (absence unconfirmed)", async () => {
    // A cold cache is not proof the note is absent: skipping the DELETE here
    // would silently fail to clear a note that exists server-side.
    const { result } = renderColdCache();
    await act(async () => {
      await result.current.remove.mutateAsync();
    });
    expect(notes.deleteAccountNote).toHaveBeenCalledWith({ id: "conn-1" }, "acc-1");
  });
});
