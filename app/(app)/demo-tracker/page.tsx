import { DemoTrackerClient } from "@/components/demo-tracker/demo-tracker-client";

export const metadata = { title: "Demo Tracker — Kracked Sales" };

export default function DemoTrackerPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden px-6 py-6">
      <DemoTrackerClient />
    </div>
  );
}
