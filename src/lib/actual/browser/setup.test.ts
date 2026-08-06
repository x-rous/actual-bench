import { initializeActualApi } from "./setup";

describe("initializeActualApi", () => {
  it("passes the config straight through to the API's init", async () => {
    const actual = {
      init: jest.fn(async () => "ready"),
    };

    await expect(
      initializeActualApi(actual, {
        serverURL: "https://actual.example.com",
        password: "password",
      })
    ).resolves.toBe("ready");

    expect(actual.init).toHaveBeenCalledWith({
      serverURL: "https://actual.example.com",
      password: "password",
    });
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
});
