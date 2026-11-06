import { getContactRules } from "@/lib/db/repo";
import { ContactRulesPanel } from "@/components/ContactRulesPanel";
import { PageHeader } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

/** The rep's list of people and companies on the receiving side: opt-outs and existing relationships. */
export default function ContactsPage() {
  return (
    <div className="max-w-[760px]">
      <PageHeader
        title="Contacts"
        description="People and companies on the receiving side. Every run is checked against this list before research, after the prospect is identified, and before any send."
      />
      <ContactRulesPanel initial={getContactRules()} />
    </div>
  );
}
