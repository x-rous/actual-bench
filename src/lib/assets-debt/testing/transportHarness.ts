import { createActualRuntimeTransport, __setDirectSettleTimingForTests } from "@/lib/actual/runtimeTransport";
import { createHttpApiTransport } from "@/lib/actual/httpApiTransport";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";
import type { FakeActual } from "./fakeActual";

/**
 * Bench's two real transports pointed at one fake Actual (RD-084 P1.6 tests).
 *
 * Direct runs the production runtime transport on a host that returns the
 * fake's runtime; HTTP runs the production HTTP transport with `apiRequest`
 * answered by the fake. The test file must `jest.mock("@/lib/api/client")` and
 * pass the mocked `apiRequest` in. Test-only.
 */

export type HarnessMode = "direct" | "http";
export const HARNESS_MODES: HarnessMode[] = ["direct", "http"];

const direct: BrowserApiConnection = {
  id: "conn-direct", label: "Direct", mode: "browser-api", baseUrl: "https://actual.example.com", serverPassword: "pw", budgetSyncId: "budget-1",
};
const http: HttpApiConnection = {
  id: "conn-http", label: "HTTP", mode: "http-api", baseUrl: "https://api.example.com", apiKey: "key", budgetSyncId: "budget-1",
};

export function transportFor(mode: HarnessMode, fake: FakeActual, apiRequestMock: jest.Mock): ActualBenchTransport {
  if (mode === "direct") {
    __setDirectSettleTimingForTests({ pollMs: 0, quietMs: 0 });
    return createActualRuntimeTransport(direct, {
      getRuntime: async () => fake.directRuntime() as never,
      sync: async () => {},
      exportBudget: async () => new Uint8Array(),
    });
  }
  apiRequestMock.mockImplementation(fake.httpApiRequest as never);
  return createHttpApiTransport(http);
}
