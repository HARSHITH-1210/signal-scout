"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { SPRING_SNAPPY, cn } from "@/lib/ui/cn";
import { Icon } from "../Icon";
import { Tooltip } from "../ui/Tooltip";
import { AccountMenu } from "./AccountMenu";
import { ThemeToggle } from "./ThemeToggle";
import { openCommandPalette } from "./CommandPalette";
import { NAV_LINKS, isActive } from "./nav";

/**
 * Search: its own round button beside the nav pill, ringed in the volt gradient so it reads as a
 * distinct control rather than another tab. Ctrl/⌘ K still opens the same palette.
 */
function SearchButton() {
  return (
    <Tooltip side="bottom" content="Search pages and runs">
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
        className="t-volt-bg group grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full p-[1.5px] transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 active:scale-95"
      >
        <span className="grid h-full w-full place-items-center rounded-full bg-surface text-fg">
          <Icon name="search" className="h-[18px] w-[18px]" />
        </span>
      </button>
    </Tooltip>
  );
}

/**
 * Centred navigation (Telemetry direction, Aurora pill box): one glass pill holding the brand and the
 * tabs, with Search as a separate button beside it. The active tab's pill and the hover pill slide
 * between tabs with shared layoutIds. Hidden on the sign-in page.
 */
export function TopNav({ user }: { user: { email: string } | null }) {
  const pathname = usePathname();
  const [hovered, setHovered] = useState<string | null>(null);
  if (pathname === "/signin") return null;

  return (
    <header className="telemetry sticky top-0 z-40 px-3 pt-4 pb-2 sm:px-6">
      <div className="relative mx-auto flex max-w-[1440px] items-center justify-center gap-2.5">
        <nav
          aria-label="Main"
          onMouseLeave={() => setHovered(null)}
          className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[var(--t-pill-line)] bg-[var(--t-pill-box)] p-1.5 backdrop-blur-[18px] [scrollbar-width:none]"
        >
          <Link href="/" aria-label="Signal Scout home" className="flex shrink-0 items-center gap-2.5 rounded-full py-2 pl-3 pr-4">
            <span aria-hidden className="t-volt-bg h-1.5 w-[26px] rounded-full" />
            <span className="hidden text-[14px] font-bold tracking-[-0.01em] sm:inline">SIGNAL SCOUT</span>
          </Link>
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => setHovered(link.href)}
                onFocus={() => setHovered(link.href)}
                className={cn(
                  "relative shrink-0 rounded-full px-4 py-2.5 text-[13px] font-medium transition-colors duration-150",
                  active ? "text-[var(--t-fg)]" : "text-[var(--t-muted)] hover:text-[var(--t-fg)]",
                )}
              >
                {hovered === link.href && !active && (
                  <motion.span layoutId="nav-hover" transition={SPRING_SNAPPY} className="absolute inset-0 rounded-full bg-[var(--t-pill-hover)]" />
                )}
                {active && <motion.span layoutId="nav-active" transition={SPRING_SNAPPY} className="absolute inset-0 rounded-full bg-[var(--t-pill-active)]" />}
                <span className="relative">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <SearchButton />

        <div className="absolute right-0 hidden items-center gap-2 lg:flex">
          <ThemeToggle />
          {user && <AccountMenu email={user.email} />}
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-2 lg:hidden">
        <ThemeToggle />
        {user && <AccountMenu email={user.email} />}
      </div>
    </header>
  );
}
