import Link from "next/link";
import { EmptyState } from "@/components/ui/Card";
import { buttonClass } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <EmptyState
      icon="search"
      title="Page not found"
      className="py-24"
      action={
        <Link href="/" className={buttonClass("secondary")}>
          Go to Outreach
        </Link>
      }
    >
      Press ⌘K to jump anywhere.
    </EmptyState>
  );
}
