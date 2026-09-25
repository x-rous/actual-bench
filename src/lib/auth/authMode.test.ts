import { authMode, passwordFromEnv, unknownAuthSetting } from "./authMode";

const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

describe("authMode", () => {
  it("asks for the password unless told not to", () => {
    expect(authMode(env({}))).toBe("password");
    expect(authMode(env({ ACTUAL_BENCH_AUTH: "password" }))).toBe("password");
    expect(authMode(env({ ACTUAL_BENCH_AUTH: " None " }))).toBe("none");
  });

  it("fails closed on an unknown value, and reports it", () => {
    expect(authMode(env({ ACTUAL_BENCH_AUTH: "off" }))).toBe("password");
    expect(unknownAuthSetting(env({ ACTUAL_BENCH_AUTH: "off" }))).toBe("off");
    expect(unknownAuthSetting(env({ ACTUAL_BENCH_AUTH: "none" }))).toBeNull();
    expect(unknownAuthSetting(env({}))).toBeNull();
  });

  it("is off for the public demo", () => {
    expect(authMode(env({ DEMO_MODE: "1" }))).toBe("none");
    expect(authMode(env({ VERCEL: "1" }))).toBe("none");
  });
});

describe("passwordFromEnv", () => {
  it("treats blank as unset and keeps the value as typed", () => {
    expect(passwordFromEnv(env({}))).toBeNull();
    expect(passwordFromEnv(env({ ACTUAL_BENCH_PASSWORD: "   " }))).toBeNull();
    expect(passwordFromEnv(env({ ACTUAL_BENCH_PASSWORD: " spaced secret " }))).toBe(" spaced secret ");
  });
});
