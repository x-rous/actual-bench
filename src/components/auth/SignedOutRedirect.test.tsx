import { render, waitFor } from "@testing-library/react";
import { SignedOutRedirect } from "./SignedOutRedirect";

const fullPageLoad = jest.fn();
jest.mock("@/lib/auth/fullPageLoad", () => ({ fullPageLoad: (path: string) => fullPageLoad(path) }));

function respond(status: number, headers: Record<string, string> = {}) {
  return { status, headers: new Headers(headers) } as Response;
}

describe("SignedOutRedirect (RD-096)", () => {
  const nativeFetch = window.fetch;
  const fake = jest.fn();

  beforeAll(() => {
    window.fetch = fake as typeof fetch;
    render(<SignedOutRedirect />);
  });
  afterAll(() => {
    window.fetch = nativeFetch;
  });
  beforeEach(() => jest.clearAllMocks());

  it("sends a signed-out session to sign in, and back to this page", async () => {
    fake.mockResolvedValue(respond(401, { "x-bench-auth": "signed-out" }));
    await window.fetch("/api/backups");
    await waitFor(() => expect(fullPageLoad).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/")}`));
  });

  it("leaves a budget server's own 401 to the feature that asked", async () => {
    fake.mockResolvedValue(respond(401));
    const response = await window.fetch("/api/proxy");
    expect(response.status).toBe(401);
    expect(fullPageLoad).not.toHaveBeenCalled();
  });
});
