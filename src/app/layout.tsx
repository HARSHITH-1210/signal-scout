import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import { missingSettings } from "@/lib/config";
import { Mark } from "@/components/Icon";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible({ variable: "--font-atkinson", subsets: ["latin"], weight: ["400", "700"] });
const splineMono = Spline_Sans_Mono({ variable: "--font-spline-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Signal Scout",
  description: "Research a prospect, verify every finding against its source, and review a grounded outreach draft.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const missing = missingSettings();
  return (
    <html lang="en" className={`${atkinson.variable} ${splineMono.variable} antialiased`}>
      <body className="min-h-screen lg:grid lg:grid-cols-[84px_minmax(0,1fr)]">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-paper focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="sticky top-0 z-30 flex items-center gap-3 bg-rail px-3 py-2 lg:h-screen lg:flex-col lg:items-center lg:gap-6 lg:px-0 lg:py-5">
          <Link href="/" className="flex items-center gap-2 text-white" aria-label="Signal Scout home">
            <Mark className="h-9 w-9" />
            <span className="sr-only">Signal Scout</span>
          </Link>
          <NavLinks />
        </header>
        <div className="min-w-0">
          {missing.length > 0 && (
            <div role="alert" className="border-b border-ochre/30 bg-ochre-soft">
              <p className="mx-auto max-w-[1440px] px-4 py-2 text-sm text-ochre sm:px-8">
                Missing {missing.join(" and ")}. New runs will fail at the first step that needs {missing.length > 1 ? "them" : "it"}. Add{" "}
                {missing.length > 1 ? "them" : "it"} to <code className="acc">.env.local</code> and restart the server.
              </p>
            </div>
          )}
          <main id="main" className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 sm:py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
