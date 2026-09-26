import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import { DemoAnalytics } from "@/components/demo-analytics";
import { Providers } from "@/components/providers";
import { CSP_NONCE_HEADER } from "@/lib/security/contentSecurityPolicy";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Actual Bench",
  description: "Bulk admin interface for Actual Budget master data",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The proxy's per-request nonce for the Content-Security-Policy. Reading it
  // renders every page per request, which a nonce needs (a page built ahead of
  // time can't carry one). Next puts it on its own scripts; the theme script is
  // ours to pass it to.
  const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full overflow-hidden font-sans">
        <Providers nonce={nonce}>{children}</Providers>
        {/* Demo-only analytics — tree-shaken out of non-Vercel builds. */}
        <DemoAnalytics />
      </body>
    </html>
  );
}