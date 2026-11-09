"use client";

import { EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/** Route error boundary: says what happened in plain words and offers a retry. Details stay in the server log. */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert">
      <EmptyState
        icon="alert"
        title="This page couldn't load"
        className="py-24"
        action={
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        }
      >
        Something went wrong while loading it. Your runs and drafts are saved. If it keeps happening, check that the server is running.
      </EmptyState>
    </div>
  );
}
