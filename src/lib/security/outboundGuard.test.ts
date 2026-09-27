import { OutboundBlockedError, assertAllowedOutbound, guardedFetch, isBlockedAddress } from "./outboundGuard";


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
  it("refuses a URL that names a refused address", () => {
    // The URL parser rewrites an IPv4-in-IPv6 address in hex.
    expect(() => assertAllowedOutbound("http://[::ffff:169.254.169.254]/")).toThrow(OutboundBlockedError);
    expect(() => assertAllowedOutbound("http://169.254.169.254/latest/meta-data/")).toThrow(OutboundBlockedError);
    expect(() => assertAllowedOutbound("http://[fd00:ec2::254]/")).toThrow(OutboundBlockedError);
  });

  it("doesn't look host names up: a name is left to connect as usual", () => {
    expect(() => assertAllowedOutbound("http://actual.lan.example:5006")).not.toThrow();
  });

  it("allows a LAN server", () => {
    expect(() => assertAllowedOutbound("http://192.168.1.20:5006")).not.toThrow();
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

  it("never reaches a metadata address through a redirect", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    const response = await guardedFetch("http://192.168.1.20/v1/");
    expect(response.status).toBe(302);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("doesn't follow a redirect to another host, which would carry the credentials along", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://elsewhere.example/v1/" } }));
    const response = await guardedFetch("https://actual.example/v1/", { headers: { "x-api-key": "key" } });
    expect(response.status).toBe(302);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("doesn't follow a redirect from https to http", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "http://actual.example/v1/" } }));
    const response = await guardedFetch("https://actual.example/v1/");
    expect(response.status).toBe(301);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
