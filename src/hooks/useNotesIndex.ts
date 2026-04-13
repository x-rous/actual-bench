"use client";

import { useQuery } from "@tanstack/react-query";
import { getNotesIndex } from "@/lib/api/notes";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

export function useNotesIndex(options: { enabled?: boolean } = {}) {
  const connection = useConnectionStore(selectActiveInstance);

  return useQuery({
    queryKey: ["notesIndex", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getNotesIndex(connection);
    },
    enabled: !!connection && (options.enabled ?? true),
    staleTime: 300_000,
  });
}
