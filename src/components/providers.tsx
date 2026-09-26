"use client";

import { useState } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { createQueryClient } from "@/lib/queryClient";
import { SignedOutRedirect } from "@/components/auth/SignedOutRedirect";

export function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  // useState ensures each browser session gets its own QueryClient instance
  const [queryClient] = useState(() => createQueryClient());

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      <QueryClientProvider client={queryClient}>
        <SignedOutRedirect />
        {children}
        <Toaster richColors position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
