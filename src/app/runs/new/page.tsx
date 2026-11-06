import Link from "next/link";
import { getSenderProfile, listDocuments } from "@/lib/db/repo";
import { NewRunForm } from "@/components/NewRunForm";
import { PipelineDiagram } from "@/components/run/PipelineDiagram";
import { Card, PageHeader } from "@/components/ui/Card";
import { Icon } from "@/components/Icon";
import { STAGES, type StageName, type StageStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const PENDING = Object.fromEntries(STAGES.map((s) => [s, "pending"])) as Record<StageName, StageStatus>;

export default function NewRunPage() {
  const sender = getSenderProfile();
  const senderDocs = listDocuments("sender");
  const offeringCount = sender.sectors.reduce((n, s) => n + s.offerings.length, 0);
  const writingAs = [sender.senderName, [sender.senderRole, sender.companyName].filter(Boolean).join(" at ")].filter(Boolean).join(", ");
  return (
    <div>
      <PageHeader
        title="Who are we researching?"
        description="Give whatever you know. One detail is enough: a name, a company, a website, or a file. Without a person's name, the draft is written for the company and suggests who should receive it."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <NewRunForm sectors={sender.sectors} />
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="overflow-hidden">
            <div className="bg-obsidian-gradient px-5 py-4">
              <p className="text-[12px] font-medium text-white/60">Writing as</p>
              {writingAs ? <p className="mt-0.5 font-medium text-white">{writingAs}</p> : <p className="mt-0.5 text-white/80">Not set up yet</p>}
            </div>
            <div className="space-y-1.5 px-5 py-4 text-[13px]">
              {!writingAs && <p className="text-warn">Drafts stay general until you describe what you sell.</p>}
              <p className="text-fg-soft">
                {offeringCount === 0 ? "No offerings yet." : `${offeringCount === 1 ? "1 offering" : `${offeringCount} offerings`} in ${sender.sectors.length === 1 ? "1 sector" : `${sender.sectors.length} sectors`}`}
              </p>
              <p className="acc text-fg-muted">{senderDocs.length === 1 ? "1 seller document" : `${senderDocs.length} seller documents`}</p>
              <Link href="/settings" className="group inline-flex min-h-9 items-center gap-1 font-medium text-fg hover:underline">
                Edit sender profile
                <Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em]">How a run works</h2>
            <PipelineDiagram statuses={PENDING} events={[]} preview />
          </Card>
        </aside>
      </div>
    </div>
  );
}
