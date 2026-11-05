"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

const LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Runs", icon: "runs" },
  { href: "/runs/new", label: "New run", icon: "plus" },
  { href: "/settings", label: "Sender", icon: "sender" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || (pathname.startsWith("/runs/") && pathname !== "/runs/new");
  return pathname.startsWith(href);
}

/** Primary navigation: a vertical rail on desktop, a horizontal bar on small screens. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 lg:flex-col lg:gap-2">
      {LINKS.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm transition-colors lg:w-[60px] lg:flex-col lg:justify-center lg:gap-1 lg:px-0 lg:py-2 lg:text-[11px] ${
              active ? "bg-rail-strong font-bold text-white" : "text-rail-muted hover:bg-rail-strong/60 hover:text-rail-ink"
            }`}
          >
            <Icon name={link.icon} className="h-[18px] w-[18px]" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
