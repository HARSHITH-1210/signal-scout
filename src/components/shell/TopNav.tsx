"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { SPRING_SNAPPY, cn } from "@/lib/ui/cn";
import { Icon, Mark } from "../Icon";
import { Kbd } from "../ui/Button";
import { ThemeToggle } from "./ThemeToggle";
import { openCommandPalette } from "./CommandPalette";
import { NAV_LINKS, isActive } from "./nav";

/**
 * Sticky top bar with the primary tabs. A hover pill follows the pointer between tabs and the
 * active tab carries an underline; both slide with shared layoutIds.
 */
export function TopNav() {
  const pathname = usePathname();
  const [hovered, setHovered] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 4));

  return (
    <header className={cn("glass sticky top-0 z-40 border-b transition-colors duration-300", scrolled ? "border-line" : "border-transparent")}>
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg" aria-label="Signal Scout home">
          <Mark className="h-7 w-7" />
          <span className="hidden text-[15px] font-semibold tracking-[-0.02em] text-fg sm:inline">Signal Scout</span>
        </Link>
        <span aria-hidden className="mx-1 hidden h-5 w-px rotate-12 bg-line md:block" />

        <nav aria-label="Main" className="hidden min-w-0 md:block" onMouseLeave={() => setHovered(null)}>
          <ul className="flex items-center gap-0.5">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <li key={link.href} className="relative">
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    onMouseEnter={() => setHovered(link.href)}
                    onFocus={() => setHovered(link.href)}
                    className={cn("relative z-10 flex h-9 items-center rounded-md px-3 text-[13px] font-medium transition-colors duration-150", active ? "text-fg" : "text-fg-muted hover:text-fg")}
                  >
                    {link.label}
                  </Link>
                  {hovered === link.href && <motion.span layoutId="nav-hover" transition={SPRING_SNAPPY} className="absolute inset-0 rounded-md bg-subtle" />}
                  {active && <motion.span layoutId="nav-active" transition={SPRING_SNAPPY} className="absolute inset-x-3 -bottom-[11px] h-[2px] rounded-full bg-obsidian" />}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={openCommandPalette}
            className="hidden h-9 items-center gap-2 rounded-lg border border-line bg-surface pl-2.5 pr-1.5 text-[13px] text-fg-muted transition-colors hover:border-fg-muted/40 hover:text-fg sm:flex"
          >
            <Icon name="search" className="h-3.5 w-3.5" />
            <span className="pr-4">Search or jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
          <button type="button" onClick={openCommandPalette} aria-label="Open command palette" className="grid h-9 w-9 place-items-center rounded-lg text-fg-muted hover:bg-subtle hover:text-fg sm:hidden">
            <Icon name="search" />
          </button>
          <ThemeToggle />
        </div>
      </div>

      {/* Small screens: the same tabs as a scrollable strip under the brand row. */}
      <nav aria-label="Main" className="md:hidden">
        <ul className="flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <li key={link.href} className="relative shrink-0">
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("relative z-10 flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors", active ? "text-obsidian-ink" : "text-fg-muted")}
                >
                  <Icon name={link.icon} className="h-3.5 w-3.5" />
                  {link.label}
                </Link>
                {active && <motion.span layoutId="nav-active-mobile" transition={SPRING_SNAPPY} className="absolute inset-0 rounded-full bg-obsidian" />}
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
