export const metadata = { title: "Privacy Policy — Kracked Sales" };

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold mb-6">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: May 2026</p>

      <div className="space-y-6 text-sm text-gray-700 leading-relaxed">
        <section>
          <h2 className="font-semibold text-base mb-2">1. Overview</h2>
          <p>Kracked Sales is an internal tool operated by Kracked Retention. This policy explains how data is handled within the platform.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">2. Data We Access</h2>
          <p>The tool accesses TikTok account data including direct messages and post comments solely for the purpose of managing customer communications on behalf of Kracked Retention.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">3. How Data Is Used</h2>
          <p>Data is used only for internal business operations — viewing and responding to messages and comments. It is never sold, shared with third parties, or used for advertising.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">4. Data Storage</h2>
          <p>Message data is fetched live from TikTok and is not permanently stored in our database. Access credentials (tokens) are stored securely and encrypted.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">5. Access Controls</h2>
          <p>Only authorised team members with valid login credentials can access this tool. All access is logged and monitored.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">6. Your Rights</h2>
          <p>To request data deletion or have questions about how your data is handled, contact the system administrator at Kracked Retention.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">7. Contact</h2>
          <p>For privacy-related enquiries, contact the system administrator.</p>
        </section>
      </div>
    </div>
  );
}
