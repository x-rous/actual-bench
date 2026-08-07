import { DEFAULT_STEP_TIMEOUT_MS, initializeActualApi } from "./setup";

describe("initializeActualApi", () => {
  it("passes the config straight through to the API's init", async () => {
    const actual = {
      init: jest.fn(async () => "ready"),
    };

    const config = {
      serverURL: "https://actual.example.com",
      password: "password",
      dataDir: "/documents",
      verbose: true,
    };

    await expect(initializeActualApi(actual, config)).resolves.toBe("ready");

    // Optional fields (dataDir, verbose) must reach init unchanged.
    expect(actual.init).toHaveBeenCalledWith(config);
  });

  it("serializes overlapping init calls so they never interleave", async () => {
    const events: string[] = [];
    let finishFirst!: () => void;

    const first = {
      init: jest.fn(
        () =>
          new Promise<string>((resolve) => {
            events.push("first-start");
            finishFirst = () => resolve("first-ready");
          })
      ),
    };
    const second = {
      init: jest.fn(async () => {
        events.push("second-start");
        return "second-ready";
      }),
    };

    const firstResult = initializeActualApi(first, {
      serverURL: "https://actual.example.com",
      password: "password",
    });
    const secondResult = initializeActualApi(second, {
      serverURL: "https://actual.example.com",
      password: "password",
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    expect(second.init).not.toHaveBeenCalled();

    finishFirst();

    await expect(firstResult).resolves.toBe("first-ready");
    await expect(secondResult).resolves.toBe("second-ready");
    expect(events).toEqual(["first-start", "second-start"]);
  });

  it("keeps the queue gated after a timeout until the real init settles", async () => {
    jest.useFakeTimers();
    try {
      let resolveFirst!: (value: string) => void;
      const first = {
        init: jest.fn(
          () => new Promise<string>((resolve) => (resolveFirst = resolve))
        ),
      };
      const second = { init: jest.fn(async () => "second-ready") };

      const config = {
        serverURL: "https://actual.example.com",
        password: "password",
      };

      const firstResult = initializeActualApi(first, config);
      firstResult.catch(() => undefined);

      // The first init never resolves; fire the init timeout.
      await jest.advanceTimersByTimeAsync(DEFAULT_STEP_TIMEOUT_MS);
      await expect(firstResult).rejects.toThrow(/did not finish/);

      // A retry must NOT start a concurrent init while the first is still
      // running inside the worker — the queue stays gated on the real promise.
      const secondResult = initializeActualApi(second, config);
      await Promise.resolve();
      await Promise.resolve();
      expect(second.init).not.toHaveBeenCalled();

      // Once the first init actually settles, the queue releases the retry.
      resolveFirst("first-ready");
      await expect(secondResult).resolves.toBe("second-ready");
      expect(second.init).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
