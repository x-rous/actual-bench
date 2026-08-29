"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Rocket } from "lucide-react";
import { useConnectionStore } from "@/store/connection";
import { generateId } from "@/lib/uuid";

type DemoBudget = { label: string; budgetSyncId: string };
type DemoConnection = {
  baseUrl: string;
  apiKey: string;
  budgets: [DemoBudget, DemoBudget];
};

/**
 * "Try the live demo" entry point on the connect screen.
 *
 * Fetches the demo connection from /api/demo after the server-rendered connect
 * page confirms DEMO_MODE=1 + the DEMO_* vars are present. Self-hosted builds do
 * not render this component, so they do not probe the demo endpoint.
 *
 * **One button per budget mode.** A visitor arrives budgeting one way or the
 * other and wants to see their own; a single button opening Envelope made
 * Tracking users start in the wrong model and work out how to switch. Both
 * budgets are still registered either way, so the other mode stays one budget
 * switch away - the choice decides which one opens, not which one exists.
 */
export function DemoButton() {
  const router = useRouter();
  const addInstance = useConnectionStore((s) => s.addInstance);
  const setActiveInstance = useConnectionStore((s) => s.setActiveInstance);
  const [demo, setDemo] = useState<DemoConnection | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/demo")
      .then((r) => (r.ok ? (r.json() as Promise<DemoConnection>) : null))
      .then((d) => {
        if (active) setDemo(d);
      })
      .catch(() => {
        if (active) setDemo(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!demo) return null; // hidden on self-hosted / non-demo deployments

  const start = (chosen: DemoBudget) => {
    setConnecting(chosen.budgetSyncId);
    let chosenInstanceId = "";

    for (const budget of demo.budgets) {
      const id = generateId();
      if (budget.budgetSyncId === chosen.budgetSyncId) chosenInstanceId = id;
      addInstance({
        id,
        label: budget.label,
        mode: "http-api",
        baseUrl: demo.baseUrl,
        apiKey: demo.apiKey,
        budgetSyncId: budget.budgetSyncId,
      });
    }

    setActiveInstance(chosenInstanceId);
    router.push("/overview");
  };

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex flex-col gap-1">
        <span className="font-semibold">New here? Try the live demo</span>
        <span className="text-sm text-muted-foreground">
          Open a sample household budget in the mode you budget in. No server setup required.
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {demo.budgets.map((budget) => (
          <button
            key={budget.budgetSyncId}
            type="button"
            onClick={() => start(budget)}
            disabled={connecting !== null}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {connecting === budget.budgetSyncId ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            {demoModeName(budget.label)} demo
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The mode a demo budget shows, for the button that opens it.
 *
 * The label the demo endpoint sends is a full budget name - "Live Demo -
 * Envelope" - which is the right name for a connection and the wrong one for a
 * button. Only the prefix is dropped, so a renamed demo budget still labels its
 * own button rather than falling back to something invented here.
 */
function demoModeName(label: string): string {
  const trimmed = label.replace(/^\s*live\s*demo\s*[-–—:]\s*/i, "").trim();
  return trimmed.length > 0 ? trimmed : label;
}
