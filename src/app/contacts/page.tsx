import { getContactRules } from "@/lib/db/repo";
import { ContactRulesPanel } from "@/components/ContactRulesPanel";

export const dynamic = "force-dynamic";

/** The rep's list of people and companies on the receiving side: opt-outs and existing relationships. */
export default function ContactsPage() {
  return (
    <div>
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em]">Contacts</h1>
      <p className="mt-1 max-w-[68ch] text-fg-soft">
        People and companies on the receiving side. Every run is checked against this list before research, after the prospect is identified, and before any send.
      </p>
      <div className="mt-6 max-w-[720px]">
        <ContactRulesPanel initial={getContactRules()} />
      </div>
    </div>
  );
}
