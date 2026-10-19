import { useSyncExternalStore } from "react";

/**
 * An in-memory stand-in for `next/navigation` in component tests:
 * `jest.mock("next/navigation", () => jest.requireActual("../components/testing/navigationMock").navigation)`.
 * `push` and `replace` update the search params and re-render subscribers, like the app router.
 */
let search = "";
const history: string[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function navigate(href: string, mode: "push" | "replace") {
  const next = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
  if (mode === "push") history.push(search);
  search = next;
  notify();
}

const router = {
  push: (href: string) => navigate(href, "push"),
  replace: (href: string) => navigate(href, "replace"),
  back: () => {
    search = history.pop() ?? "";
    notify();
  },
  forward: () => undefined,
  refresh: () => undefined,
  prefetch: () => undefined,
};

export const navigation = {
  useRouter: () => router,
  usePathname: () => "/credit-cards",
  useSearchParams: () => {
    const current = useSyncExternalStore(subscribe, () => search, () => search);
    return new URLSearchParams(current);
  },
};

export function resetNavigation(query = "") {
  search = query.replace(/^\?/, "");
  history.length = 0;
  notify();
}

export const currentSearch = () => new URLSearchParams(search);
export const navigationRouter = router;
