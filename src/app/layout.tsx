import type { Metadata } from "next";
import { Martian_Mono, Outfit } from "next/font/google";
import { missingSettings } from "@/lib/config";
import { TopNav } from "@/components/shell/TopNav";
import { Providers } from "./providers";
import "./globals.css";

// Telemetry direction: Outfit for display and UI, Martian Mono for labels and data.
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["300", "400", "500", "600", "700"] });
const martianMono = Martian_Mono({ variable: "--font-martian", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Signal Scout",
  description: "Research a prospect, verify every finding against its source, and review a grounded outreach draft.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const missing = missingSettings();
  return (
    <html lang="en" suppressHydrationWarning className={`${outfit.variable} ${martianMono.variable} antialiased`}>
      <body className="min-h-screen">
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
            Skip to content
          </a>
          <TopNav />
          {missing.length > 0 && (
            <div role="alert" className="border-b border-warn/25 bg-warn-soft">
              <p className="mx-auto max-w-[1440px] px-4 py-2 text-[13px] text-warn sm:px-8">
                Missing {missing.join(" and ")}. New runs will fail at the first step that needs {missing.length > 1 ? "them" : "it"}. Add{" "}
                {missing.length > 1 ? "them" : "it"} to <code className="acc">.env.local</code> and restart the server.
              </p>
            </div>
          )}
          <main id="main" className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-10">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
