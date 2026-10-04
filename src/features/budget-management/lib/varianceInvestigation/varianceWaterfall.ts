import type { Driver, VarianceModel } from "./varianceViewModel";

/**
 * The budget-to-actual waterfall as data: Budget, the largest unfavourable
 * drivers, favourable offsets, Actual. It always reconciles, because Actual is
 * the running total after the last step and is checked against the headline.
 */

export type WaterfallSegment = {
  kind: "total" | "driver" | "other";
  key: string;
  /** Short label for the axis. */
  label: string;
  /** Full name for tooltips, with a count for aggregated segments. */
  name: string;
  /** Drivers this segment stands for. An `other` segment keeps every id. */
  driverIds: string[];
  budget: number;
  actual: number;
  /** Signed unfavourable amount. */
  variance: number;
  /** Effect on the running total: `actual - budget`. */
  delta: number;
  from: number;
  to: number;
  favourable: boolean;
  /** Share of the gross side; `null` for totals. */
  share: number | null;
};

export type Waterfall = {
  segments: WaterfallSegment[];
  /** The running total after the last driver. Equals the model's actual. */
  endValue: number;
  reconciles: boolean;
};

export type WaterfallOptions = {
  /** How many unfavourable drivers to show individually. Default 5. */
  maxUnfavourable?: number;
  /** How many favourable drivers to show individually. Default 2. */
  maxFavourable?: number;
};

export function buildWaterfall(
  model: VarianceModel,
  options: WaterfallOptions = {}
): Waterfall {
  const maxUnfavourable = options.maxUnfavourable ?? 5;
  const maxFavourable = options.maxFavourable ?? 2;
  const unfavourable = model.drivers.filter((d) => d.variance > 0);
  const favourable = model.drivers
    .filter((d) => d.variance < 0)
    .sort((a, b) => a.variance - b.variance);

  const segments: WaterfallSegment[] = [];
  let running = model.total.budget;
  segments.push({
    kind: "total",
    key: "budget",
    label: model.vocab.budget,
    name: model.vocab.budget,
    driverIds: [],
    budget: running,
    actual: running,
    variance: 0,
    delta: 0,
    from: 0,
    to: running,
    favourable: false,
    share: null,
  });

  const push = (kind: "driver" | "other", key: string, label: string, name: string, group: Driver[]) => {
    const budget = group.reduce((t, d) => t + d.budget, 0);
    const actual = group.reduce((t, d) => t + d.actual, 0);
    const variance = group.reduce((t, d) => t + d.variance, 0);
    const delta = actual - budget;
    const from = running;
    running += delta;
    const shareSum = group.reduce((t, d) => t + (d.share ?? 0), 0);
    segments.push({
      kind,
      key,
      label,
      name,
      driverIds: group.map((d) => d.id),
      budget,
      actual,
      variance,
      delta,
      from,
      to: running,
      favourable: variance < 0,
      share: group.some((d) => d.share != null) ? shareSum : null,
    });
  };

  const noun = model.level === "group" ? "groups" : "categories";
  const addGroup = (drivers: Driver[], max: number, otherLabel: string, side: "u" | "f") => {
    // One leftover driver would be a "+1 other" bar; show it by name instead.
    const individually = drivers.length > max + 1 ? max : drivers.length;
    drivers.slice(0, individually).forEach((d) => push("driver", d.id, d.name, d.name, [d]));
    const rest = drivers.slice(individually);
    if (rest.length > 0) {
      push("other", `other-${side}`, otherLabel, `${otherLabel} (${rest.length} ${noun})`, rest);
    }
  };
  addGroup(unfavourable, maxUnfavourable, model.vocab.otherUnfavourable, "u");
  addGroup(favourable, maxFavourable, model.vocab.otherFavourable, "f");

  segments.push({
    kind: "total",
    key: "actual",
    label: model.vocab.actual,
    name: model.vocab.actual,
    driverIds: [],
    budget: running,
    actual: running,
    variance: 0,
    delta: 0,
    from: 0,
    to: running,
    favourable: false,
    share: null,
  });

  return { segments, endValue: running, reconciles: running === model.total.actual };
}
