import type { FxRateResult } from "../types";

/**
 * Provider abstraction (RD-056 / PR-025a, FX doc §4.1). Transaction-processing
 * logic depends on this interface, never on a concrete provider. A provider only
 * *fetches* a rate; persistence into the registry is the resolver's job.
 */
export interface FxRateProvider {
  readonly name: string;
  getRate(input: { baseCurrency: string; quoteCurrency: string; date: string }): Promise<FxRateResult>;
}
