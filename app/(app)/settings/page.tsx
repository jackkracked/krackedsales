import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ScrollToTop } from "@/components/layout/scroll-to-top";

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto flex flex-col">
      <ScrollToTop />
      <SettingsTabs />
    </div>
  );
}
