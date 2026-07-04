"use client";

import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

export function useAllNotes() {
  const connection = useConnectionStore(selectActiveInstance);

  return useQuery({
    queryKey: ["allNotes", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getTransport(connection).getAllNotes();
    },
    enabled: !!connection,
    staleTime: 300_000,
  });
}
