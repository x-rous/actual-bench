import type { ProgressView } from "@/lib/financial-insights/progress";
import { useProgressSwitches } from "../../hooks/useProgressSwitches";
import { ProgressTab } from "../ProgressTab";

/** The tab with the setting the page holds for it, for tests. */
export function ProgressTabHarness({ view, onSeeAllTime }: { view: ProgressView; onSeeAllTime?: () => void }) {
  const { switches, change } = useProgressSwitches();
  return <ProgressTab view={view} switches={switches} onSwitches={change} onSeeAllTime={onSeeAllTime} />;
}
