import { ContactsClient } from "@/components/contacts/contacts-client";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "Contacts — Kracked Sales" };
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  // The Customers view is admin-only (mirrors /kpis + /money). Reps only ever see Contacts.
  const user = await getSessionUser().catch(() => null);
  const isAdmin = user?.role === "admin";

  return (
    <div className="flex flex-col h-full p-6 gap-4 overflow-hidden">
      <div>
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Contacts
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every lead across GHL and comment sources
        </p>
      </div>
      <ContactsClient isAdmin={isAdmin} />
    </div>
  );
}
