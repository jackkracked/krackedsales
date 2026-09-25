import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { TrackerClient } from "@/components/tracker/tracker-client";

export const metadata = { title: "Pay Tracker — Kracked Sales" };
export const dynamic = "force-dynamic";

/**
 * A person's own pay, replacing the hand-kept commission workbook.
 *
 * Deliberately NOT admin-gated like /money. Money is the company's revenue and belongs to Jack;
 * this is the viewer's own earnings and belongs to them. The API returns only the session's own
 * figures unless the viewer is an admin, so there is nothing here for a rep to gate against.
 */
export default async function TrackerPage() {
  const user = await getSessionUser().catch(() => null);
  if (!user) redirect("/login");
  return <TrackerClient isAdmin={user.role === "admin"} selfId={user.id} />;
}
