import { getSenderProfile, listDocuments, toStoredDocument } from "@/lib/db/repo";
import { GmailPanel } from "@/components/GmailPanel";
import { SettingsForm } from "@/components/SettingsForm";
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
      <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em]">Sender profile</h1>
      <p className="mt-1 max-w-[68ch] text-ink-soft">
        Your business only: who the drafts come from and what you sell. Every field is optional. Drafts only claim what you write here or what your documents
        say, and never invent customers or results. People you&apos;re writing to belong under Contacts.
      </p>
      <SettingsForm
        initial={getSenderProfile()}
        initialDocuments={listDocuments("sender").map(toStoredDocument)}
        aside={<GmailPanel initial={gmailStatus()} result={gmailResult(params)} />}
      />
    </div>
  );
}
