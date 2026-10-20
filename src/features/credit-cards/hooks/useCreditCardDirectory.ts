"use client";

import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import { readCardDirectory } from "../lib/read/directory";

export function useCreditCardDirectory(connection: ConnectionInstance | null) {
  return useQuery({
    queryKey: ["creditCardDirectory", connection?.id, connection?.budgetSyncId],
    queryFn: () => {
      if (!connection) throw new Error("Connect a budget to read credit cards");
      return readCardDirectory(getTransport(connection));
    },
    enabled: Boolean(connection),
    staleTime: Infinity, gcTime: Infinity,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
}

/** Category mappings use the complete directory, including categories without card activity. */
export function useCreditCardCategories(connection: ConnectionInstance, enabled: boolean) {
  return useQuery({
    queryKey: ["categoryGroups", connection.id, connection.budgetSyncId],
    queryFn: () => getTransport(connection).getCategoryGroups(),
    enabled,
    staleTime: Infinity, gcTime: Infinity,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
}
