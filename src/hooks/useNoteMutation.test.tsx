import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNoteMutation } from "./useNoteMutation";
import { toAccountNoteId } from "../lib/api/notes";

const mockTransport = {
  mode: "http-api",
  setAccountNote: jest.fn(() => Promise.resolve()),
  deleteAccountNote: jest.fn(() => Promise.resolve()),
};

const mockGetTransport = jest.fn(() => mockTransport);
const mockSyncTransportAfterChanges = jest.fn(() => Promise.resolve());

jest.mock("../lib/actual", () => ({
  getTransport: (connection: unknown) => (mockGetTransport as jest.Mock)(connection),
  syncTransportAfterChanges: (transport: unknown, changed: unknown) =>
    (mockSyncTransportAfterChanges as jest.Mock)(transport, changed),
}));

let mockActiveConnection: { id: string; mode: "http-api" | "browser-api" } = {
  id: "conn-1",
  mode: "http-api",
};

jest.mock("../store/connection", () => ({
  useConnectionStore: jest.fn(() => mockActiveConnection),
  selectActiveInstance: jest.fn(),
}));

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
  const client = new QueryClient();
  return renderHook(() => useNoteMutation("account", "acc-1"), {
    wrapper: makeWrapper(client),
  });
}

describe("useNoteMutation", () => {
  beforeEach(() => {
    mockActiveConnection = { id: "conn-1", mode: "http-api" };
    mockGetTransport.mockClear();
    mockSyncTransportAfterChanges.mockClear();
    mockTransport.setAccountNote.mockClear();
    mockTransport.deleteAccountNote.mockClear();
  });

  it("skips the DELETE when an empty save clears a note that never existed", async () => {
    const { result } = renderWithNotes([]);
    await act(async () => {
      await result.current.save.mutateAsync("   ");
    });
    expect(mockTransport.deleteAccountNote).not.toHaveBeenCalled();
    expect(mockTransport.setAccountNote).not.toHaveBeenCalled();
    expect(mockSyncTransportAfterChanges).not.toHaveBeenCalled();
  });

  it("sends the DELETE through the active transport when clearing a note that exists", async () => {
    const { result } = renderWithNotes([[toAccountNoteId("acc-1"), "existing"]]);
    await act(async () => {
      await result.current.remove.mutateAsync();
    });
    expect(mockGetTransport).toHaveBeenCalledWith(mockActiveConnection);
    expect(mockTransport.deleteAccountNote).toHaveBeenCalledWith("acc-1");
    expect(mockSyncTransportAfterChanges).toHaveBeenCalledWith(mockTransport, true);
  });

  it("sends the DELETE when the notes cache is cold", async () => {
    const { result } = renderColdCache();
    await act(async () => {
      await result.current.remove.mutateAsync();
    });
    expect(mockTransport.deleteAccountNote).toHaveBeenCalledWith("acc-1");
  });

  it("syncs after Direct note writes through the transport", async () => {
    mockActiveConnection = { id: "conn-1", mode: "browser-api" };
    const { result } = renderWithNotes([[toAccountNoteId("acc-1"), "existing"]]);
    await act(async () => {
      await result.current.save.mutateAsync("updated");
    });
    expect(mockTransport.setAccountNote).toHaveBeenCalledWith("acc-1", "updated");
    expect(mockSyncTransportAfterChanges).toHaveBeenCalledWith(mockTransport, true);
  });
});
