import { initializeActualApi } from "./setup";

type WorkerRecord = {
  scriptURL: string | URL;
  options?: WorkerOptions;
  messages: unknown[];
};

const originalWorker = window.Worker;

class MockNativeWorker {
  static instances: WorkerRecord[] = [];

  private record: WorkerRecord;

  constructor(scriptURL: string | URL, options?: WorkerOptions) {
    this.record = { scriptURL, options, messages: [] };
    MockNativeWorker.instances.push(this.record);
  }

  postMessage(message: unknown): void {
    this.record.messages.push(message);
  }
}

function installMockWorker() {
  MockNativeWorker.instances = [];
  Object.defineProperty(window, "Worker", {
    configurable: true,
    writable: true,
    value: MockNativeWorker,
  });
}

function restoreWorker() {
  Object.defineProperty(window, "Worker", {
    configurable: true,
    writable: true,
    value: originalWorker,
  });
}

describe("initializeActualApi", () => {
  beforeEach(() => {
    installMockWorker();
  });

  afterEach(() => {
    restoreWorker();
  });

  it("redirects only Actual backend worker URLs through the asset route", async () => {
    const unrelatedWorkerUrl = new URL("https://cdn.example.com/other-worker.js");
    const actual = {
      init: jest.fn(async () => {
        const ActualWorker = window.Worker;
        const backend = new ActualWorker(
          new URL("https://cdn.example.com/@actual-app/api/dist/worker.js"),
          { type: "module" }
        );
        const unrelated = new ActualWorker(unrelatedWorkerUrl);
        const plainWorker = new ActualWorker(new URL("https://cdn.example.com/worker.js"));

        backend.postMessage({ name: "api-browser/init", args: { config: true } });
        unrelated.postMessage({ name: "other/init" });
        plainWorker.postMessage({ name: "plain/init" });
        return "ready";
      }),
    };

    await expect(
      initializeActualApi(actual, {
        serverURL: "https://actual.example.com",
        password: "password",
      })
    ).resolves.toBe("ready");

    expect(MockNativeWorker.instances).toHaveLength(3);
    expect(String(MockNativeWorker.instances[0].scriptURL)).toBe(
      "http://localhost/actual-api-assets/worker.js"
    );
    expect(MockNativeWorker.instances[0].options).toEqual({ type: "module" });
    expect(MockNativeWorker.instances[0].messages[0]).toEqual({
      name: "api-browser/init",
      args: {
        config: true,
        assetsBaseUrl: "http://localhost/actual-api-assets/",
      },
    });
    expect(MockNativeWorker.instances[1].scriptURL).toBe(unrelatedWorkerUrl);
    expect(MockNativeWorker.instances[1].messages[0]).toEqual({ name: "other/init" });
    expect(String(MockNativeWorker.instances[2].scriptURL)).toBe(
      "https://cdn.example.com/worker.js"
    );
    expect(MockNativeWorker.instances[2].messages[0]).toEqual({ name: "plain/init" });
    expect(window.Worker).toBe(MockNativeWorker);
  });

  it("serializes overlapping init calls so Worker restore order stays stable", async () => {
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
    expect(window.Worker).toBe(MockNativeWorker);
  });
});
