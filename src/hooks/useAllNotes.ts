"use client";

import { useQuery } from "@tanstack/react-query";
import { getAllNotes } from "@/lib/api/notes";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

export function useAllNotes() {
  const connection = useConnectionStore(selectActiveInstance);

  return useQuery({
    queryKey: ["allNotes", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getAllNotes(connection);
    },
    enabled: !!connection,
    staleTime: 300_000,
  });
}
