import Link from "next/link";
import { getSenderProfile, listDocuments } from "@/lib/db/repo";
import { NewRunForm } from "@/components/NewRunForm";
import { PipelineDiagram } from "@/components/run/PipelineDiagram";
import { STAGES, type StageName, type StageStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const PENDING = Object.fromEntries(STAGES.map((s) => [s, "pending"])) as Record<StageName, StageStatus>;

export default function NewRunPage() {
  const sender = getSenderProfile();
  const senderDocs = listDocuments("sender");
  const offeringCount = sender.sectors.reduce((n, s) => n + s.offerings.length, 0);
  return (
    <div>
      <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em]">Research a prospect</h1>
      <p className="mt-1 max-w-[68ch] text-ink-soft">
        Give whatever you know. One detail is enough: a name, a company, a website, a LinkedIn profile, or a file. Without a person&apos;s name, the draft is written for
        the company and suggests who should receive it.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <NewRunForm sectors={sender.sectors} />
        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-[var(--radius-panel)] border border-rule bg-paper p-5">
            <h2 className="mb-3 text-[15px] font-bold">How a run works</h2>
            <PipelineDiagram statuses={PENDING} events={[]} preview />
          </div>
          <div className="rounded-[var(--radius-panel)] border border-rule bg-paper p-5 text-sm">
            <h2 className="text-[15px] font-bold">Writing as</h2>
            {sender.senderName || sender.companyName ? (
              <p className="mt-1 text-ink-soft">{[sender.senderName, [sender.senderRole, sender.companyName].filter(Boolean).join(" at ")].filter(Boolean).join(", ")}</p>
            ) : (
              <p className="mt-1 text-ochre">Not set up yet. Drafts stay general until you describe what you sell.</p>
            )}
            <p className="mt-2 text-ink-soft">
              {offeringCount === 0 ? "No offerings yet." : `${offeringCount === 1 ? "1 offering" : `${offeringCount} offerings`} in ${sender.sectors.length === 1 ? "1 sector" : `${sender.sectors.length} sectors`}.`}
            </p>
            <p className="acc mt-2 text-muted">{senderDocs.length === 1 ? "1 seller document" : `${senderDocs.length} seller documents`}</p>
            <Link href="/settings" className="mt-3 inline-flex min-h-11 items-center font-bold text-det hover:underline">
              Edit sender profile
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
