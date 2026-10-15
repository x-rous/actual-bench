import { Circle, CircleCheck, CircleHelp } from "lucide-react";

/** Read-only Actual clearing evidence, shared by transaction review and payments. */
export function ClearingStatus({ cleared, available = true }: { cleared: boolean | null; available?: boolean }) {
  const label = !available ? "Clearing status unavailable" : cleared === null ? "Unknown clearing status" : cleared ? "Cleared" : "Uncleared";
  return <span role="img" aria-label={label} title={label} className="flex justify-center">{!available || cleared === null ? <CircleHelp className="size-4 text-muted-foreground" aria-hidden /> : cleared ? <CircleCheck className="size-4 text-green-700 dark:text-green-400" aria-hidden /> : <Circle className="size-4 text-muted-foreground" aria-hidden />}</span>;
}
