import { getSenderProfile, listDocuments, toStoredDocument } from "@/lib/db/repo";
import { GmailPanel } from "@/components/GmailPanel";
import { SettingsForm } from "@/components/SettingsForm";
import { PageHeader } from "@/components/ui/Card";
import { gmailStatus } from "@/lib/gmail/send";

export const dynamic = "force-dynamic";

/** The OAuth callback reports back through the query string; only short, fixed-length text is shown. */
function gmailResult(params: Record<string, string | string[] | undefined>) {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string).slice(0, 200) : undefined);
  if (one("gmail") === "connected") return { tone: "ok" as const, text: `Gmail connected${one("account") ? ` as ${one("account")}` : ""}.` };
  if (one("gmail") === "error") return { tone: "bad" as const, text: one("reason") ?? "Connecting Gmail failed." };
  return null;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return (
    <div>
      <PageHeader
        title="Sender profile"
        label="Your business only · every field optional"
      />
      <SettingsForm
        initial={getSenderProfile()}
        initialDocuments={listDocuments("sender").map(toStoredDocument)}
        aside={<GmailPanel initial={gmailStatus()} result={gmailResult(params)} />}
      />
    </div>
  );
}
