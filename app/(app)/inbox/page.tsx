import { InboxClient } from "@/components/inbox/inbox-client";

export const metadata = { title: "Inbox — Kracked Sales" };

export default function InboxPage() {
  return (
    // Inbox takes the full content area — no internal padding
    <div className="h-full overflow-hidden">
      <InboxClient />
    </div>
  );
}
