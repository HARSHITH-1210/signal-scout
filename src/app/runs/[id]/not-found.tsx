import Link from "next/link";
import { EmptyState } from "@/components/ui/Card";
import { buttonClass } from "@/components/ui/Button";

export default function RunNotFound() {
  return (
    <EmptyState
      icon="runs"
      title="Run not found"
      className="py-24"
      action={
        <Link href="/runs" className={buttonClass("secondary")}>
          Back to runs
        </Link>
      }
    >
      It may have been deleted, or created on a different database.
    </EmptyState>
  );
}
