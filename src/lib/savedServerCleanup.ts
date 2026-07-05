import type { ConnectionInstance } from "@/store/connection";
import type { SavedServer } from "@/store/savedServers";

export function findUnusedSavedServerId(
  instance: ConnectionInstance,
  instances: ConnectionInstance[],
  savedServers: SavedServer[]
): string | null {
  const stillUsed = instances.some(
    (other) =>
      other.id !== instance.id &&
      other.mode === instance.mode &&
      other.baseUrl === instance.baseUrl
  );

  if (stillUsed) return null;

  return (
    savedServers.find(
      (server) => server.mode === instance.mode && server.baseUrl === instance.baseUrl
    )?.id ?? null
  );
}

export function removeSavedServerIfUnused({
  instance,
  instances,
  savedServers,
  removeServer,
}: {
  instance: ConnectionInstance;
  instances: ConnectionInstance[];
  savedServers: SavedServer[];
  removeServer: (id: string) => void;
}): void {
  const savedServerId = findUnusedSavedServerId(instance, instances, savedServers);
  if (savedServerId) removeServer(savedServerId);
}
