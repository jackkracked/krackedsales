import { ContactsClient } from "@/components/contacts/contacts-client";

export const metadata = { title: "Contacts — Kracked Sales" };

export default function ContactsPage() {
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
      <ContactsClient />
    </div>
  );
}
