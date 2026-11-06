import type { IconName } from "../Icon";

export const NAV_LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Outreach", icon: "mail" },
  { href: "/runs", label: "Runs", icon: "runs" },
  { href: "/runs/new", label: "New run", icon: "plus" },
  { href: "/contacts", label: "Contacts", icon: "contacts" },
  { href: "/settings", label: "Sender", icon: "sender" },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/runs") return pathname === "/runs" || (pathname.startsWith("/runs/") && pathname !== "/runs/new");
  return pathname.startsWith(href);
}
