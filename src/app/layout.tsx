import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full overflow-hidden font-sans">
        <Providers>{children}</Providers>
        {/* Vercel Web Analytics — only on the Vercel-hosted demo, never in
            self-hosted/Docker builds (no beacon injected off-Vercel). */}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}