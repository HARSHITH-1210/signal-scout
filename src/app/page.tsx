import { OutreachDashboard } from "@/components/OutreachDashboard";
import { gmailStatus } from "@/lib/gmail/send";
import { outreachStats } from "@/lib/outreach/load";

export const dynamic = "force-dynamic";

/** Home: the Outreach dashboard. The runs list lives at /runs. */
export default function OutreachPage() {
  return <OutreachDashboard initial={outreachStats()} gmail={gmailStatus()} />;
}
