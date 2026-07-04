"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Rocket } from "lucide-react";
import { useConnectionStore } from "@/store/connection";
import { generateId } from "@/lib/uuid";

type DemoConnection = { baseUrl: string; apiKey: string; budgetSyncId: string };

/**
 * "Try the live demo" entry point on the connect screen.
 *
 * Fetches the demo connection from /api/demo after the server-rendered connect
 * page confirms DEMO_MODE=1 + the DEMO_* vars are present. Self-hosted builds
 * do not render this component, so they do not probe the demo endpoint. Clicking
 * it registers the demo as the active connection and drops the visitor straight
 * into the app — the normal "bring your own actual-http-api"
 * form below remains the default path.
 */
export function DemoButton() {
  const router = useRouter();
  const addInstance = useConnectionStore((s) => s.addInstance);
  const setActiveInstance = useConnectionStore((s) => s.setActiveInstance);
  const [demo, setDemo] = useState<DemoConnection | null>(null);
  const [connecting, setConnecting] = useState(false);

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

  const start = () => {
    setConnecting(true);
    const id = generateId();
    addInstance({
      id,
      label: "Live Demo",
      mode: "http-api",
      baseUrl: demo.baseUrl,
      apiKey: demo.apiKey,
      budgetSyncId: demo.budgetSyncId,
    });
    setActiveInstance(id);
    router.push("/overview");
  };

  return (
    <div className="w-full max-w-xl rounded-xl border border-primary/30 bg-primary/5 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <span className="font-semibold">New here? Try the live demo</span>
        <span className="text-sm text-muted-foreground">
          Explore a sample budget instantly — no server setup required.
        </span>
      </div>
      <button
        type="button"
        onClick={start}
        disabled={connecting}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {connecting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Rocket className="h-4 w-4" />
        )}
        Try the live demo
      </button>
    </div>
  );
}
