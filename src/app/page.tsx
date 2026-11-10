import { OutreachDashboard } from "@/components/OutreachDashboard";
import { gmailStatus } from "@/lib/gmail/send";
import { currentUser } from "@/lib/auth/server";
import { outreachStats } from "@/lib/outreach/load";
import { providerStatus } from "@/lib/providers/status";

export const dynamic = "force-dynamic";

/** Home: the Outreach dashboard. The runs list lives at /runs. */
export default async function OutreachPage() {
  const user = await currentUser();
  return <OutreachDashboard initial={outreachStats()} gmail={gmailStatus(user?.email ?? null)} providers={providerStatus()} />;
}
