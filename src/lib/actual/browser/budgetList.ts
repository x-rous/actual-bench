"use client";

/**
 * Lists the budgets on an Actual Server from the browser, for the connect
 * form's Direct mode. Three plain requests, the same ones Actual's own client
 * makes: sign in, then the file list and the server version together.
 *
 * It deliberately doesn't start Actual's browser runtime. That runtime is one
 * per tab and serves the open budget: starting it just to read a list cost
 * seconds (a large worker and SQLite's WebAssembly), was repeated when the
 * budget was then opened, and shut down whatever budget the tab had open.
 * Direct mode already needs the browser to reach the server with CORS, which
 * is all these requests need too.
 */

import { assertDirectBrowserApiEnvironment } from "./environment";
import { normalizeUrl } from "./setup";

export type BrowserApiBudgetListInput = {
  serverUrl: string;
  serverPassword: string;
};

export type BrowserApiBudget = {
  id?: string;
  cloudFileId?: string;
  name?: string;
  state?: string;
  groupId?: string;
  encryptKeyId?: string | null;
  hasKey?: boolean;
  owner?: string;
};

export type BrowserApiBudgetListResult = {
  budgets: BrowserApiBudget[];
  serverVersion: string | null;
};

type ServerAnswer<T> = { status: "ok"; data: T } | { status: "error"; reason?: string; details?: string };

type RemoteFile = {
  deleted?: boolean | number;
  fileId: string;
  groupId: string | null;
  name: string;
  encryptKeyId?: string | null;
  owner?: string | null;
};

const REQUEST_TIMEOUT_MS = 15_000;

class ServerUnreachableError extends Error {}

async function ask<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new ServerUnreachableError();
  }
  const body = (await response.json().catch(() => null)) as T | null;
  return { status: response.status, body };
}

function signInError(status: number, body: ServerAnswer<unknown> | null): Error {
  if (status === 429) {
    return new Error("Too many sign-in attempts on the Actual Server. Wait a few minutes and try again.");
  }
  const reason = body?.status === "error" ? body.reason : undefined;
  if (reason === "invalid-password") return new Error("Incorrect Actual Server password.");
  return new Error(`The Actual Server did not accept the sign-in${reason ? ` (${reason})` : ""}.`);
}

async function signIn(serverUrl: string, password: string): Promise<string> {
  const { status, body } = await ask<ServerAnswer<{ token?: string }>>(`${serverUrl}/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginMethod: "password", password }),
  });
  if (body?.status === "ok" && body.data.token) return body.data.token;
  throw signInError(status, body);
}

async function listFiles(serverUrl: string, token: string): Promise<RemoteFile[]> {
  const { body } = await ask<ServerAnswer<RemoteFile[]>>(`${serverUrl}/sync/list-user-files`, {
    headers: { "X-ACTUAL-TOKEN": token },
  });
  if (body?.status === "ok" && Array.isArray(body.data)) return body.data;
  const reason = body?.status === "error" ? body.reason : undefined;
  throw new Error(`The Actual Server did not list its budgets${reason ? ` (${reason})` : ""}.`);
}

async function readVersion(serverUrl: string): Promise<string | null> {
  try {
    const { body } = await ask<{ build?: { version?: string } }>(`${serverUrl}/info`);
    return body?.build?.version ?? null;
  } catch {
    return null;
  }
}

/** One entry per budget: live files only, each sync id once. */
function toBudgets(files: RemoteFile[]): BrowserApiBudget[] {
  const seen = new Set<string>();
  return files.flatMap((file) => {
    if (file.deleted || !file.groupId || seen.has(file.groupId)) return [];
    seen.add(file.groupId);
    return [
      {
        cloudFileId: file.fileId,
        name: file.name,
        state: "remote",
        groupId: file.groupId,
        encryptKeyId: file.encryptKeyId ?? null,
        // Whether this browser holds the budget's key: it never does before
        // the budget is opened; the encryption password is asked for then.
        hasKey: false,
        owner: file.owner ?? undefined,
      },
    ];
  });
}

export async function loadBrowserApiBudgetList(
  input: BrowserApiBudgetListInput
): Promise<BrowserApiBudgetListResult> {
  const serverUrl = normalizeUrl(input.serverUrl);
  if (!serverUrl) throw new Error("Actual Server URL is required.");
  if (!input.serverPassword) throw new Error("Actual Server password is required.");
  // Listing works without it, but opening the budget won't: say so now.
  assertDirectBrowserApiEnvironment();

  try {
    const token = await signIn(serverUrl, input.serverPassword);
    const [files, serverVersion] = await Promise.all([listFiles(serverUrl, token), readVersion(serverUrl)]);
    return { budgets: toBudgets(files), serverVersion };
  } catch (error) {
    if (error instanceof ServerUnreachableError) {
      throw new Error(
        `Cannot reach the Actual Server at ${serverUrl}. Check the address, that it is running, and that it allows this browser to connect (CORS).`
      );
    }
    throw error;
  }
}

export async function listBrowserApiBudgets(input: BrowserApiBudgetListInput): Promise<BrowserApiBudget[]> {
  return (await loadBrowserApiBudgetList(input)).budgets;
}
