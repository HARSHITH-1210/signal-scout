import { getSenderProfile, listDocuments, toStoredDocument } from "@/lib/db/repo";
import { GmailPanel } from "@/components/GmailPanel";
import { SettingsForm } from "@/components/SettingsForm";
import { PageHeader } from "@/components/ui/Card";
import { gmailStatus } from "@/lib/gmail/send";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Sender profile"
        label="Your business only · every field optional"
      />
      <SettingsForm
        initial={getSenderProfile()}
        initialDocuments={listDocuments("sender").map(toStoredDocument)}
        aside={<GmailPanel initial={gmailStatus()} />}
      />
    </div>
  );
}
