"use client";

import { useQuery } from "@tanstack/react-query";
import { getAccountNote, getCategoryLikeNote } from "@/lib/api/notes";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

export type EntityNoteKind = "account" | "category";

export function useEntityNote(
  kind: EntityNoteKind,
  id: string,
  enabled: boolean
) {
  const connection = useConnectionStore(selectActiveInstance);

  return useQuery({
    queryKey: ["entityNote", kind, connection?.id, id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return kind === "account"
        ? getAccountNote(connection, id)
        : getCategoryLikeNote(connection, id);
    },
    enabled: !!connection && enabled && !!id,
    staleTime: 300_000,
  });
}
