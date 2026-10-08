import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { classifyPosting } from "../classification/policy";
import { byKind, createScenario } from "../testing/postingScenario";
import { executeApprovedPosting } from "./applyService";
import { PostingNotApproved } from "./postingErrors";
import { approveAndBeginApply, proposeReversal } from "./postingWorkflowService";
import { reproducePosting } from "./reproduceService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/**
 * SC-018: every applied posting is user-approved, and no code path applies a
 * posting without an explicit user action. Part static (who may import the
 * write paths), part behavioural (what the write paths refuse).
 */

const ROOT = join(__dirname, "../../../..");
const SRC = join(ROOT, "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !path.includes(`${join("assets-debt", "testing")}`) ? [path] : [];
  });
}
const files = sources(SRC).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));
const importers = (pattern: RegExp) => files.filter((f) => pattern.test(f.text)).map((f) => f.path).sort();

describe("no auto-apply (SC-018)", () => {
  it("only the user's posting actions module runs the browser apply executor", () => {
    expect(importers(/from ["'][^"']*services\/applyService["']/).filter((p) => !p.endsWith("postingsApi.ts"))).toEqual([
      "src/features/assets-debt/lib/postingActions.ts",
    ]);
    // postingsApi imports types only.
    const api = files.find((f) => f.path.endsWith("features/assets-debt/lib/postingsApi.ts"))!;
    expect(api.text).toMatch(/import type \{[^}]*\} from "@\/lib\/assets-debt\/services\/applyService"/);
    expect(importers(/\bexecuteApprovedPosting\(/)).toEqual(["src/features/assets-debt/lib/postingActions.ts", "src/lib/assets-debt/services/applyService.ts"]);
  });

  it("only the apply route records approval and starts applying; only the workflow service calls the repository transitions", () => {
    const workflowImporters = files.filter((f) => /from ["'][^"']*services\/postingWorkflowService["']/.test(f.text));
    expect(workflowImporters.filter((f) => /\b(approveAndBeginApply|beginCompleteLink)\b/.test(f.text)).map((f) => f.path)).toEqual([
      "src/app/api/assets-debt/postings/[id]/apply/route.ts",
    ]);
    // Every server importer of the workflow is a thin route handler.
    expect(workflowImporters.every((f) => f.path.startsWith("src/app/api/assets-debt/postings/"))).toBe(true);
    expect(importers(/\b(decidePosting|beginApplyingPosting)\b/).filter((p) => !p.endsWith("financialPostingRepository.ts"))).toEqual([
      "src/lib/assets-debt/services/postingWorkflowService.ts",
    ]);
  });

  it("the user's actions run only from click handlers: no effect, timer or job reaches them", () => {
    expect(importers(/\b(applyPosting|completeInterruptedLink)\b/).filter((p) => !p.endsWith("postingActions.ts"))).toEqual([
      "src/features/assets-debt/components/workspace/LoanActivity.tsx",
    ]);
    for (const path of ["src/features/assets-debt/components/workspace/LoanActivity.tsx", "src/features/assets-debt/lib/postingActions.ts", "src/lib/assets-debt/services/applyService.ts"]) {
      let text = files.find((f) => f.path === path)!.text;
      if (path.endsWith("postingActions.ts")) {
        const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
        const heartbeat = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "executionHeartbeat");
        expect(heartbeat).toBeDefined();
        // A lease heartbeat may renew metadata, but it must never reach an Actual writer.
        const visit = (node: ts.Node) => {
          if (ts.isCallExpression(node)) {
            if (ts.isIdentifier(node.expression)) expect(["setInterval", "renewExecution", "clearInterval"]).toContain(node.expression.text);
            else expect(node.expression.getText(source)).toBe("renewExecution(id, token).catch");
          }
          ts.forEachChild(node, visit);
        };
        visit(heartbeat!);
        text = text.slice(0, heartbeat!.getStart(source)) + text.slice(heartbeat!.end);
      }
      expect({ path, effect: /useEffect|setInterval|setTimeout|automation/.test(text) }).toEqual({ path, effect: false });
    }
    expect(importers(/assets-debt\/services\/(applyService|postingWorkflowService)/).filter((p) => p.includes("/automation/"))).toEqual([]);
  });

  it("the executor throws PostingNotApproved unless the server recorded the user's approval", async () => {
    const s = createScenario({ mode: "direct", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const [charge] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    expect(charge.classification).toBe("safe");
    const ctx = { transport: s.transport, transferPayeeByAccount: s.transferPayees, offBudgetAccountIds: s.offBudgetIds, liabilityAccountId: "acc-mortgage" };
    for (const forged of [{ ...charge }, { ...charge, status: "applying" as const, decidedAt: null }, { ...charge, status: "approved" as const, decidedAt: "x" }]) {
      await expect(executeApprovedPosting({ posting: forged, mode: "apply" }, ctx)).rejects.toBeInstanceOf(PostingNotApproved);
    }
    expect(s.fake.writes()).toEqual([]);
  });

  it("a safe proposal writes nothing until the user's explicit Apply; preview, Undo and reproduce never write", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const [charge] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    await s.preview({ from: "2024-02-01", to: "2024-02-29" });
    expect(s.fake.writes()).toEqual([]);
    await s.apply(charge);
    const writes = s.fake.writes().length;
    proposeReversal(s.db, charge.id, { accountDirectory: s.directory, transferPayees: s.transferPayees, today: "2024-06-03" });
    reproducePosting(s.db, charge.id);
    await s.preview({ from: "2024-02-01", to: "2024-02-29" });
    expect(s.fake.writes().length).toBe(writes);
  });

  it("a blocked proposal cannot be approved, so it can never be applied", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01", -242915, { reconciled: true });
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    expect(() => approveAndBeginApply(s.db, split.id, { fresh: [], decidedAt: "2024-06-02T00:00:00.000Z" })).toThrow(/blocked/);
    expect(s.fake.writes()).toEqual([]);
  });

  it("classification never produces safe for a restructure, counterpart link, split, opening or reconciliation adjustment, or unreviewed principal change (without the planner's FR-170c routine-split flag)", () => {
    const cases = [
      { postingKind: "repayment-split" as const, shape: "restructure" as const },
      { postingKind: "repayment-link" as const, shape: "link" as const },
      { postingKind: "opening-adjustment" as const, shape: "create" as const },
      { postingKind: "reconciliation-adjustment" as const, shape: "create" as const },
    ];
    for (const c of cases) expect(classifyPosting({ ...c, driftMaterial: false }).classification).not.toBe("safe");
    expect(classifyPosting({ postingKind: "interest-charge", shape: "create", driftMaterial: false, unreviewedPrincipalChange: true }).classification).toBe("review");
  });
});
