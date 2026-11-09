import type { Metadata } from "next";
import Link from "next/link";
import { gmailConfigured } from "@/lib/gmail/client";
import { safeNextPath } from "@/lib/auth/session";
import { Icon } from "@/components/Icon";

export const metadata: Metadata = { title: "Sign in · Signal Scout" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Google's "G" mark, as Google's sign-in branding asks for on the button. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="h-[18px] w-[18px]">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

const PERMISSIONS = [
  { icon: "sender", text: "Your name and email address, to sign you in" },
  { icon: "mail", text: "Send email, only a draft you approve and confirm" },
  { icon: "shield", text: "Read headers (sender, time) of threads it sent, for replies and bounces. Never message bodies." },
] as const;

/** Google sign-in. Signing in also connects the Gmail account approved drafts are sent from. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const error = one(params.error)?.slice(0, 240);
  const next = safeNextPath(one(params.next));
  const href = `/api/auth/signin${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`;
  const configured = gmailConfigured();

  return (
    <div className="telemetry flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-[420px] rounded-[var(--radius-panel)] border border-line bg-surface p-7 sm:p-8">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="t-volt-bg h-1.5 w-[26px] rounded-full" />
          <span className="text-[14px] font-bold tracking-[-0.01em]">SIGNAL SCOUT</span>
        </div>
        <h1 className="mt-6 text-[24px] font-semibold leading-tight tracking-[-0.025em]">Sign in</h1>
        <p className="mt-2 text-[14px] text-fg-muted">Use your Google account. Approved drafts are sent from its Gmail, so there&apos;s nothing else to connect.</p>

        {error && (
          <p role="alert" className="mt-5 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {configured ? (
          <a
            href={href}
            className="mt-6 flex h-11 w-full items-center justify-center gap-3 rounded-full border border-line bg-white px-5 text-[14px] font-medium text-[#1f1f1f] shadow-sm transition-colors hover:bg-[#f2f2f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <GoogleMark />
            Sign in with Google
          </a>
        ) : (
          <div className="mt-6 rounded-lg border border-line bg-subtle px-3 py-2.5 text-sm text-fg-muted">
            Google sign-in isn&apos;t set up. Add <code className="acc">GOOGLE_CLIENT_ID</code> and <code className="acc">GOOGLE_CLIENT_SECRET</code> to{" "}
            <code className="acc">.env.local</code> and restart. Until then the app runs without sign-in on this machine.{" "}
            <Link href="/" className="font-medium text-fg underline underline-offset-4">
              Continue
            </Link>
          </div>
        )}

        <div className="mt-7 border-t border-line pt-5">
          <p className="t-label">Google will ask to let Signal Scout</p>
          <ul className="mt-3 space-y-2.5">
            {PERMISSIONS.map((p) => (
              <li key={p.icon} className="flex gap-2.5 text-[13px] text-fg-muted">
                <Icon name={p.icon} className="mt-0.5 h-4 w-4 shrink-0" />
                {p.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
