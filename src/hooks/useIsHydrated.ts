import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

export function useIsHydrated(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}
