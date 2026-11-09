import Link from "next/link";
import { getSenderProfile, listDocuments } from "@/lib/db/repo";
import { NewRunForm } from "@/components/NewRunForm";
import { STAGES, STAGE_LABELS, type StageName } from "@/lib/types";

export const dynamic = "force-dynamic";

/** One line on what each stage does, for the "How a run works" panel. */
const STAGE_NOTE: Record<StageName, string> = {
  validate: "Checks the details and any files",
  resolve_identity: "Confirms who the prospect is",
  research: "Searches news, hiring and interviews",
  extract_signals: "Proposes findings, each with a quote",
  verify: "Matches every quote word for word",
  rank_hook: "Scores relevance, freshness, source",
  draft: "Writes from verified facts only",
  guard: "Audits every claim before you see it",
};

export default function NewRunPage() {
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
      <p className="mt-3 max-w-[72ch] text-[14px] text-[var(--t-muted)]">
        Give whatever you know: a name, a company, a website, or a file. Without a person&apos;s name, the draft is written for the company and suggests who should
        receive it.
      </p>

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <NewRunForm sectors={sender.sectors} />

        <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <section aria-labelledby="writing-as" className="t-card-inv p-5">
            <h2 id="writing-as" className="t-label">
              Writing as
            </h2>
            {writingAs ? (
              <p className="mt-2 text-[15px] font-semibold leading-snug tracking-[-0.01em]">{writingAs}</p>
            ) : (
              <p className="mt-2 text-[14px] text-[var(--t-warn)]">Not set up yet. Drafts stay general until you describe what you sell.</p>
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

          <section aria-labelledby="how-title" className="t-card p-5">
            <div className="flex items-baseline justify-between">
              <h2 id="how-title" className="t-label">
                How a run works
              </h2>
              <span className="t-mono text-[11px] text-[var(--t-muted)]">~1 min</span>
            </div>
            <ol className="mt-4 space-y-3">
              {STAGES.map((stage, i) => (
                <li key={stage} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3">
                  <span className="t-mono pt-px text-[11px] text-[var(--t-muted)]">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <span aria-hidden className="t-seg mb-2 block h-[3px] rounded-full" style={{ backgroundPosition: `${(i / (STAGES.length - 1)) * 100}% 0` }} />
                    <p className="text-[13px] font-medium">{STAGE_LABELS[stage]}</p>
                    <p className="text-[12px] text-[var(--t-muted)]">{STAGE_NOTE[stage]}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="t-mono mt-4 border-t border-[var(--t-line)] pt-3 text-[11px] text-[var(--t-muted)]">Nothing is sent until you approve it.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
