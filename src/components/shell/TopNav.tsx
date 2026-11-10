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
        className="t-volt-bg group grid h-11 w-11 shrink-0 sm:h-[52px] sm:w-[52px] place-items-center rounded-full p-[1.5px] transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 active:scale-95"
      >
        <span className="grid h-full w-full place-items-center rounded-full bg-surface text-fg">
          <Icon name="search" className="h-[18px] w-[18px]" />
        </span>
      </button>
    </Tooltip>
  );
}

/**
 * Phones: every destination in a fixed tab bar at the bottom, in thumb reach, instead of a top pill
 * that scrolls its tabs out of sight. Labels stay visible so icons never have to stand alone.
 */
function BottomTabs({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Main"
      className="telemetry fixed inset-x-0 bottom-0 z-40 border-t border-[var(--t-pill-line)] bg-[var(--t-pill-box)] pb-[env(safe-area-inset-bottom)] backdrop-blur-[18px] sm:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-6 px-1">
        {NAV_LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[10.5px] font-medium leading-none transition-colors",
                  active ? "text-[var(--t-fg)]" : "text-[var(--t-muted)]",
                )}
              >
                {active && <motion.span layoutId="tab-active" transition={SPRING_SNAPPY} className="absolute inset-x-1.5 inset-y-1.5 rounded-xl bg-[var(--t-pill-active)]" />}
                <Icon name={link.icon} className="relative h-[18px] w-[18px]" />
                <span className="relative whitespace-nowrap">{link.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
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
    <>
      <header className="telemetry sticky top-0 z-40 px-3 pt-3 pb-2 sm:px-6 sm:pt-4">
        {/* Phones: brand, theme, account and search in one compact row; the tabs live at the bottom. */}
        <div className="flex items-center gap-2 rounded-full border border-[var(--t-pill-line)] bg-[var(--t-pill-box)] p-1.5 pl-4 backdrop-blur-[18px] sm:hidden">
          <Link href="/" aria-label="Signal Scout home" className="mr-auto flex items-center gap-2.5 py-2">
            <span aria-hidden className="t-volt-bg h-1.5 w-[22px] rounded-full" />
            <span className="whitespace-nowrap text-[13px] font-bold tracking-[-0.01em] max-[359px]:hidden">SIGNAL SCOUT</span>
          </Link>
          <ThemeToggle />
          {user && <AccountMenu email={user.email} />}
          <SearchButton />
        </div>
        <div className="relative mx-auto hidden max-w-[1440px] items-center justify-center gap-2.5 sm:flex">
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
        <div className="mt-2 hidden justify-center gap-2 sm:flex lg:hidden">
          <ThemeToggle />
          {user && <AccountMenu email={user.email} />}
        </div>
      </header>
      <BottomTabs pathname={pathname} />
    </>
  );
}
