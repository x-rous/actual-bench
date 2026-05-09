"use client";

import { useState, useEffect, createContext, useContext } from "react";

export type VersionCheckState = {
  latestVersion: string | null;
  updateAvailable: boolean;
  dismissed: boolean;
  dismiss: () => void;
};

export const VersionCheckContext = createContext<VersionCheckState>({
  latestVersion: null,
  updateAvailable: false,
  dismissed: false,
  dismiss: () => {},
});

export function useVersionCheckContext(): VersionCheckState {
  return useContext(VersionCheckContext);
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const core = v.replace(/^v/, "").split(/[-+]/)[0];
    const parts = (core ?? "").split(".").slice(0, 3);
    const [maj, min, pat] = [0, 1, 2].map((i) => Number(parts[i]) || 0);
    return [maj, min, pat];
  };
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  return bMaj - aMaj || bMin - aMin || bPat - aPat;
}

function dismissKey(version: string) {
  return `version-update-dismissed:${version}`;
}

export function useVersionCheck(): VersionCheckState {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/version-check")
      .then((r) => r.json())
      .then((data: { currentVersion: string; latestVersion: string }) => {
        if (cancelled) return;
        const { latestVersion: latest } = data;
        setLatestVersion(latest);
        setDismissed(localStorage.getItem(dismissKey(latest)) === "1");
      })
      .catch(() => { /* silently ignore — version check is non-critical */ });

    return () => { cancelled = true; };
  }, []);

  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const updateAvailable =
    latestVersion !== null && compareSemver(currentVersion, latestVersion) > 0;

  function dismiss() {
    if (!latestVersion) return;
    localStorage.setItem(dismissKey(latestVersion), "1");
    setDismissed(true);
  }

  return { latestVersion, updateAvailable, dismissed, dismiss };
}
