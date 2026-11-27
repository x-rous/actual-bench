import { actualDesktopServerUrl, isDesktopApp } from "./desktopMode";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("desktop mode", () => {
  it("is off unless the desktop app says so", () => {
    expect(isDesktopApp(env({}))).toBe(false);
    expect(actualDesktopServerUrl(env({ ACTUAL_BENCH_ACTUAL_DESKTOP_SERVER_URL: "http://localhost:5007" }))).toBeNull();
  });

  it("offers the Actual desktop server inside the desktop app", () => {
    const desktop = env({ ACTUAL_BENCH_DESKTOP: "1", ACTUAL_BENCH_ACTUAL_DESKTOP_SERVER_URL: "http://localhost:5007/" });
    expect(isDesktopApp(desktop)).toBe(true);
    expect(actualDesktopServerUrl(desktop)).toBe("http://localhost:5007");
  });

  it.each([
    "not a url",
    "file:///etc/passwd",
    "http://user:secret@localhost:5007",
    "http://localhost:5007/?token=x",
    "http://localhost:5007/#x",
  ])("refuses %s", (value) => {
    expect(
      actualDesktopServerUrl(env({ ACTUAL_BENCH_DESKTOP: "1", ACTUAL_BENCH_ACTUAL_DESKTOP_SERVER_URL: value }))
    ).toBeNull();
  });
});
