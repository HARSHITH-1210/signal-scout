import Link from "next/link";
import { getSenderProfile, listDocuments } from "@/lib/db/repo";
import { NewRunForm } from "@/components/NewRunForm";

export const dynamic = "force-dynamic";

/** Discover links here with ?company=…&website=… to prefill the form; values are capped and still validated on submit. */
export default async function NewRunPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (k: string, max: number) => (typeof params[k] === "string" ? (params[k] as string).trim().slice(0, max) : "");
  const prefill = { company: one("company", 120), companyWebsite: one("website", 200) };
  const sender = getSenderProfile();
  const senderDocs = listDocuments("sender");
  const offeringCount = sender.sectors.reduce((n, s) => n + s.offerings.length, 0);
  const writingAs = [sender.senderName, [sender.senderRole, sender.companyName].filter(Boolean).join(" at ")].filter(Boolean).join(", ");
  return (
    <div className="telemetry">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em]">New run</h1>
          <p className="t-label mt-1.5">Research a prospect · one detail is enough</p>
        </div>
        <Link href="/runs" className="t-mono text-[11px] text-[var(--t-muted)] hover:text-[var(--t-fg)]">
          All runs →
        </Link>
      </header>

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <NewRunForm sectors={sender.sectors} prefill={prefill} />

        <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <section aria-labelledby="writing-as" className="t-card-inv p-5">
            <h2 id="writing-as" className="t-label">
              Writing as
            </h2>
            {writingAs ? (
              <p className="mt-2 text-[15px] font-semibold leading-snug tracking-[-0.01em]">{writingAs}</p>
            ) : (
              <p className="mt-2 text-[14px] text-[var(--t-warn)]">Not set up yet.</p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--t-line)] pt-4">
              <div>
                <dt className="t-label">Offerings</dt>
                <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.02em]">{offeringCount}</dd>
              </div>
              <div>
                <dt className="t-label">Seller docs</dt>
                <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.02em]">{senderDocs.length}</dd>
              </div>
            </dl>
            <Link href="/settings" className="t-mono mt-4 inline-flex min-h-9 items-center text-[11px] uppercase tracking-[0.1em] text-[var(--t-muted)] underline-offset-4 hover:underline">
              Edit sender profile →
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
