import { getSenderProfile, listDocuments, toStoredDocument } from "@/lib/db/repo";
import { GmailPanel } from "@/components/GmailPanel";
import { SettingsForm } from "@/components/SettingsForm";
import { PageHeader } from "@/components/ui/Card";
import { gmailStatus } from "@/lib/gmail/send";
import { currentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  return (
    <div>
      <PageHeader
        title="Sender profile"
        label="Your business only · every field optional"
      />
      <SettingsForm
        initial={getSenderProfile()}
        initialDocuments={listDocuments("sender").map(toStoredDocument)}
        aside={<GmailPanel initial={gmailStatus(user?.email ?? null)} />}
      />
    </div>
  );
}
