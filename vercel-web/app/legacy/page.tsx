import { redirect } from "next/navigation";

/** Classic CRM retired — redirect to the React dashboard. */
export default function LegacyPage() {
  redirect("/dashboard");
}
