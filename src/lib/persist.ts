export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function getPersistedState<TState extends object>(value: unknown): Partial<TState> {
  if (typeof value !== "object" || value === null) return {};
  if (
    "state" in value &&
    typeof value.state === "object" &&
    value.state !== null
  ) {
    return value.state as Partial<TState>;
  }
  return value as Partial<TState>;
}
