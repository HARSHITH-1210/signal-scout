"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/ui/cn";
import { send } from "../run/api";
import { Icon } from "../Icon";
import { Popover } from "../ui/Popover";

/** The signed-in Google account, and Sign out. Sending uses this same account. */
export function AccountMenu({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function signOut() {
    setBusy(true);
    await send("/api/auth/signout", "POST");
    // Refresh drops the client cache, so no page keeps showing data from the ended session.
    router.replace("/signin");
    router.refresh();
  }

  return (
    <Popover
      label="Account"
      align="end"
      className="w-64"
      triggerClassName={(open) =>
        cn(
          "grid h-9 w-9 place-items-center rounded-full border border-[var(--t-pill-line)] bg-[var(--t-pill-box)] text-[13px] font-semibold uppercase backdrop-blur-[18px] transition-colors hover:text-[var(--t-fg)]",
          open ? "text-[var(--t-fg)]" : "text-[var(--t-muted)]",
        )
      }
      trigger={() => (
        <>
          <span className="sr-only">Account: {email}</span>
          <span aria-hidden>{email.charAt(0)}</span>
        </>
      )}
    >
      <div className="px-2.5 pb-2 pt-1.5">
        <p className="t-label">Signed in with Google</p>
        <p className="acc mt-1 truncate text-sm text-fg" title={email}>
          {email}
        </p>
        <p className="mt-1 text-[12px] text-fg-muted">Approved drafts are sent from this account.</p>
      </div>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-50"
      >
        <Icon name="signOut" className="h-4 w-4" />
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </Popover>
  );
}
