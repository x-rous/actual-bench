export const DIRECT_MODE_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

export function isDirectBrowserApiDisabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off";
}

type DirectModeEnv = {
  DIRECT_BROWSER_API?: string;
  NEXT_PUBLIC_DIRECT_BROWSER_API?: string;
};

export function isDirectBrowserApiEnabled(
  env: DirectModeEnv = {
    DIRECT_BROWSER_API: process.env.DIRECT_BROWSER_API,
    NEXT_PUBLIC_DIRECT_BROWSER_API: process.env.NEXT_PUBLIC_DIRECT_BROWSER_API,
  }
): boolean {
  return (
    !isDirectBrowserApiDisabled(env.DIRECT_BROWSER_API) &&
    !isDirectBrowserApiDisabled(env.NEXT_PUBLIC_DIRECT_BROWSER_API)
  );
}
