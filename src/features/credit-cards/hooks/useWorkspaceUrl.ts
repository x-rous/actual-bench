"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const WORKSPACE_TABS = ["overview", "statements", "payments", "activity", "plans", "insights"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

/**
 * Everything that makes a view linkable lives in the URL (§9.2): Back returns to the previous
 * card, tab or filter, and a copied link opens the same view.
 */
export type WorkspaceUrl = {
  card: string | null;
  tab: WorkspaceTab;
  /** The statement shown in the side panel, on Statements. */
  statement: string | null;
  /** The statement under review (full screen). */
  review: string | null;
  /** The payment shown in the side panel, on Payments. */
  payment: string | null;
  /** The pill filter of the current tab (for example "attention" on Statements). */
  view: string | null;
  /** Activity's statement filter: a statement id or "current". */
  in: string | null;
  /** Activity's plan filter. */
  plan: string | null;
};

const KEYS = ["card", "tab", "statement", "review", "payment", "view", "in", "plan"] as const;

export function parseWorkspaceUrl(params: URLSearchParams): WorkspaceUrl {
  const value = (key: string) => params.get(key) || null;
  const tab = value("tab");
  return {
    card: value("card"),
    tab: WORKSPACE_TABS.includes(tab as WorkspaceTab) ? tab as WorkspaceTab : "overview",
    statement: value("statement"),
    review: value("review"),
    payment: value("payment"),
    view: value("view"),
    in: value("in"),
    plan: value("plan"),
  };
}

export function workspaceQuery(state: Partial<WorkspaceUrl>) {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = state[key];
    if (value && !(key === "tab" && value === "overview")) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Navigation (card, tab, review) pushes a history entry so Back works; panels and filters replace
 * the current one so Back does not step through every row opened.
 */
export function useWorkspaceUrl() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = parseWorkspaceUrl(new URLSearchParams(params?.toString() ?? ""));
  const go = (patch: Partial<WorkspaceUrl>, mode: "push" | "replace" = "push") => {
    router[mode](`${pathname}${workspaceQuery({ ...state, ...patch })}`, { scroll: false });
  };
  return { url: state, go };
}
