import { OutboundBlockedError, assertAllowedOutbound, guardedFetch, isBlockedAddress } from "./outboundGuard";

const resolved: Record<string, string[]> = {
  "metadata.internal.example": ["169.254.169.254"],
  "actual.lan.example": ["192.168.1.20"],
};
jest.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    const addresses = resolved[host];
    if (!addresses) throw new Error("ENOTFOUND");
    return addresses.map((address) => ({ address, family: 4 }));
  },
}));

beforeAll(() => {
  delete process.env.ACTUAL_BENCH_TEST_SKIP_DNS;
});

describe("isBlockedAddress (F-194)", () => {
  it("refuses the cloud metadata endpoints", () => {
    for (const address of ["169.254.169.254", "169.254.170.2", "100.100.100.200", "fd00:ec2::254", "::ffff:169.254.169.254"]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it("allows LAN, localhost and public addresses, where Actual servers live", () => {
    for (const address of ["192.168.1.20", "10.0.0.5", "172.16.0.9", "127.0.0.1", "::1", "fd12:3456::1", "8.8.8.8", "100.100.100.201"]) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });

  it("allows the rest of link-local, which container runtimes use for the host", () => {
    // Rootless Podman's host.containers.internal.
    for (const address of ["169.254.1.2", "fe80::1"]) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });
});

describe("assertAllowedOutbound", () => {
  it("refuses a URL that names a refused address", async () => {
    await expect(assertAllowedOutbound("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(OutboundBlockedError);
    await expect(assertAllowedOutbound("http://[fd00:ec2::254]/")).rejects.toBeInstanceOf(OutboundBlockedError);
  });

  it("refuses a name that resolves to a metadata address, and allows one that resolves to the LAN", async () => {
    await expect(assertAllowedOutbound("http://metadata.internal.example/")).rejects.toBeInstanceOf(OutboundBlockedError);
    await expect(assertAllowedOutbound("http://actual.lan.example:5006")).resolves.toBeUndefined();
    // A name that doesn't resolve is left to fail on its own.
    await expect(assertAllowedOutbound("http://nowhere.example")).resolves.toBeUndefined();
  });

  it("allows a LAN server", async () => {
    await expect(assertAllowedOutbound("http://192.168.1.20:5006")).resolves.toBeUndefined();
  });
});

describe("guardedFetch", () => {
  afterEach(() => jest.restoreAllMocks());

  it("follows a redirect to an allowed address, checking it first", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://192.168.1.20/v1/" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const response = await guardedFetch("http://192.168.1.20/v1/");
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenLastCalledWith("https://192.168.1.20/v1/", expect.objectContaining({ redirect: "manual" }));
  });

  it("refuses a redirect to a metadata address", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    await expect(guardedFetch("http://192.168.1.20/v1/")).rejects.toBeInstanceOf(OutboundBlockedError);
  });
});
