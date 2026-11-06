"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { SPRING_SNAPPY, cn } from "@/lib/ui/cn";
import { Icon } from "../Icon";
import { ThemeToggle } from "./ThemeToggle";
import { openCommandPalette } from "./CommandPalette";
import { NAV_LINKS, isActive } from "./nav";

/**
 * Centred navigation (Telemetry direction, Aurora pill box): one glass pill holding the brand and the
 * tabs. The active tab's pill and the hover pill slide between tabs with shared layoutIds.
 */
export function TopNav() {
  const pathname = usePathname();
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <header className="telemetry sticky top-0 z-40 px-3 pt-4 pb-2 sm:px-6">
      <div className="relative mx-auto flex max-w-[1440px] items-center justify-center">
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

        <div className="absolute right-0 hidden items-center gap-2 lg:flex">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Open command palette"
            className="t-mono flex h-9 items-center gap-2 rounded-full border border-[var(--t-pill-line)] bg-[var(--t-pill-box)] px-3 text-[12px] text-[var(--t-muted)] backdrop-blur-[18px] transition-colors hover:text-[var(--t-fg)]"
          >
            <Icon name="search" className="h-3.5 w-3.5" />
            ⌘K
          </button>
          <ThemeToggle />
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-2 lg:hidden">
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="Open command palette"
          className="grid h-9 w-9 place-items-center rounded-full border border-[var(--t-pill-line)] bg-[var(--t-pill-box)] text-[var(--t-muted)] backdrop-blur-[18px]"
        >
          <Icon name="search" className="h-3.5 w-3.5" />
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
