import { redirect } from "next/navigation";

/** Old address of the Outreach dashboard, now the home page. */
export default function OutreachRedirect() {
  redirect("/");
}
