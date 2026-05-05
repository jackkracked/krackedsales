export const metadata = { title: "Terms of Service — Kracked Sales" };

export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold mb-6">Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: May 2026</p>

      <div className="space-y-6 text-sm text-gray-700 leading-relaxed">
        <section>
          <h2 className="font-semibold text-base mb-2">1. About This Tool</h2>
          <p>Kracked Sales is an internal business tool used exclusively by authorised members of the Kracked Retention team. It is not a public-facing product or service.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">2. Access</h2>
          <p>Access is restricted to employees and contractors of Kracked Retention who have been issued login credentials by an administrator. Unauthorised access is prohibited.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">3. Acceptable Use</h2>
          <p>This tool may only be used for legitimate business purposes including managing customer communications, tracking sales activity, and reviewing performance data.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">4. Data</h2>
          <p>All data accessed through this tool is owned by Kracked Retention. Users must not export, share, or misuse any data accessed through this platform.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">5. Contact</h2>
          <p>For questions about these terms, contact the system administrator.</p>
        </section>
      </div>
    </div>
  );
}
