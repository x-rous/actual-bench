import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { DemoAnalytics } from "@/components/demo-analytics";
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
        {/* Demo-only analytics — tree-shaken out of non-Vercel builds. */}
        <DemoAnalytics />
      </body>
    </html>
  );
}