"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { getImportedTextIndex } from "../lib/importedTextIndex";
import type { ImportedTextRow } from "../lib/ruleCandidates";

/**
 * Historical import text, for backtesting proposed rules.
 *
 * Loaded lazily and cached for the session: it is a whole-budget read, and the
 * answer does not change while the user works through a cleanup.
 */
const EMPTY_ROWS: ImportedTextRow[] = [];

export function useImportedTextIndex(options: { enabled: boolean }): {
  rows: ImportedTextRow[];
  truncated: boolean;
  isLoading: boolean;
} {
  const connection = useConnectionStore(selectActiveInstance);

  const { data, isLoading } = useQuery({
    queryKey: ["payeeCleanupImportedText", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getImportedTextIndex(connection);
    },
    enabled: options.enabled && !!connection,
  });

  // A fresh `[]` on every render would change the scan's dependencies and
  // re-run the whole pipeline while the history is still loading.
  const rows = useMemo(() => data?.rows ?? EMPTY_ROWS, [data]);
  return { rows, truncated: data?.truncated ?? false, isLoading };
}
