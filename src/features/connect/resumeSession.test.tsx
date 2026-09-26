import { waitFor } from "@testing-library/react";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import { resumeSession } from "./resumeSession";
import { clearSessionRecord, getSessionRecord, recordOf, setSessionRecord } from "./sessionRecord";

const revealServerSecret = jest.fn();
jest.mock("./vaultApi", () => ({ revealServerSecret: (...args: unknown[]) => revealServerSecret(...args) }));
const ensureConnectionReady = jest.fn(async () => undefined);
jest.mock("./reconnectFromVault", () => ({
  ...jest.requireActual("./reconnectFromVault"),
  ensureConnectionReady: (...args: unknown[]) => ensureConnectionReady(...(args as [])),
}));

function revealed(baseUrl: string) {
  return { mode: "http-api", baseUrl, label: "", secret: { apiKey: "key", serverPassword: null, encryptionPassword: null } };
}

const home = { fingerprint: "srv-a", budgetSyncId: "b-1", label: "Household" };
const joint = { fingerprint: "srv-a", budgetSyncId: "b-2", label: "Joint" };
const gone = { fingerprint: "srv-b", budgetSyncId: "b-3", label: "Forgotten" };

describe("session record", () => {
  afterEach(() => clearSessionRecord());

  it("keeps the active budget and the others, and nothing secret", () => {
    const a = { id: "1", label: "Household", mode: "http-api", baseUrl: "https://api.example.com", budgetSyncId: "b-1", apiKey: "SECRET" } as ConnectionInstance;
    const b = { ...a, id: "2", label: "Joint", budgetSyncId: "b-2" } as ConnectionInstance;
    setSessionRecord(recordOf(a, [a, b]));

    const record = getSessionRecord()!;
    expect(record.active.budgetSyncId).toBe("b-1");
    expect(record.others.map((budget) => budget.budgetSyncId)).toEqual(["b-2"]);
    expect(JSON.stringify(sessionStorage)).not.toContain("SECRET");
  });

  it("reads a tab's record from before other budgets were kept", () => {
    sessionStorage.setItem("actual-admin-last-active-ref", JSON.stringify(home));
    expect(getSessionRecord()).toEqual({ active: home, others: [] });
  });
});

describe("resumeSession", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useConnectionStore.getState().clearAll();
  });

  it("reopens the active budget, then brings the others back without opening them", async () => {
    revealServerSecret.mockImplementation(async (fingerprint: string, budgetSyncId: string) => {
      if (budgetSyncId === "b-3") throw new Error("not saved");
      return revealed(`https://${fingerprint}.example.com`);
    });

    await resumeSession({ active: home, others: [joint, gone] });

    const state = useConnectionStore.getState();
    const active = state.instances.find((instance) => instance.id === state.activeInstanceId);
    expect(active?.budgetSyncId).toBe("b-1");
    expect(ensureConnectionReady).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useConnectionStore.getState().instances.map((i) => i.budgetSyncId).sort()).toEqual(["b-1", "b-2"]));
    expect(useConnectionStore.getState().activeInstanceId).toBe(active?.id);
  });

  it("brings nothing back if the user disconnected before the others arrived", async () => {
    let releaseJoint!: () => void;
    revealServerSecret.mockImplementation(async (_fingerprint: string, budgetSyncId: string) => {
      if (budgetSyncId === "b-2") await new Promise<void>((resolve) => (releaseJoint = resolve));
      return revealed("https://srv.example.com");
    });

    await resumeSession({ active: home, others: [joint] });
    useConnectionStore.getState().clearAll();
    releaseJoint();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useConnectionStore.getState().instances).toEqual([]);
  });

  it("keeps a budget the user connected themselves meanwhile", async () => {
    let releaseJoint!: () => void;
    revealServerSecret.mockImplementation(async (_fingerprint: string, budgetSyncId: string) => {
      if (budgetSyncId === "b-2") await new Promise<void>((resolve) => (releaseJoint = resolve));
      return revealed("https://srv.example.com");
    });

    await resumeSession({ active: home, others: [joint] });
    const theirs = { id: "theirs", label: "Joint", mode: "http-api", baseUrl: "https://new.example.com", budgetSyncId: "b-2", apiKey: "k" } as ConnectionInstance;
    useConnectionStore.getState().addInstance(theirs);
    releaseJoint();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const joints = useConnectionStore.getState().instances.filter((i) => i.budgetSyncId === "b-2");
    expect(joints.map((i) => i.id)).toEqual(["theirs"]);
  });

  it("fails when the active budget can't be reopened, adding nothing", async () => {
    revealServerSecret.mockRejectedValue(new Error("locked"));
    await expect(resumeSession({ active: home, others: [joint] })).rejects.toThrow("locked");
    expect(useConnectionStore.getState().instances).toEqual([]);
  });
});
