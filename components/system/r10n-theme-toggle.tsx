"use client";

import { useEffect, useState } from "react";

/**
 * Admin-only r10n theme toggle.
 *
 * A compact fixed-position pill. It is rendered by the app layout ONLY when the
 * session user is an admin, so non-admins never see it and it never affects their
 * layout (it is position:fixed, so it is also out of normal document flow).
 *
 * Clicking it POSTs to /api/theme to set/clear the `r10n_theme` cookie, then
 * reloads so the SSR layout re-renders with (or without) data-theme="r10n".
 */
export function R10nThemeToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  // Read the current state from the live <html data-theme> on mount.
  useEffect(() => {
    setEnabled(document.documentElement.getAttribute("data-theme") === "r10n");
  }, []);

  async function toggle() {
    if (busy) return;
    const next = !enabled;
    // Instant swap: flip data-theme on <html> right now so every [data-theme="r10n"]
    // rule + token applies immediately, with no reload.
    if (next) document.documentElement.setAttribute("data-theme", "r10n");
    else document.documentElement.removeAttribute("data-theme");
    setEnabled(next);
    setBusy(true);
    // Persist the cookie in the background so SSR matches on the next load. No reload.
    try {
      const res = await fetch("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error("persist failed");
    } catch {
      // Revert the instant swap if persistence failed.
      if (next) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", "r10n");
      setEnabled(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={enabled ? "Switch back to the default theme" : "Preview the r10n theme"}
      style={{ fontFamily: "var(--font-sans)" }}
      className="fixed bottom-4 left-4 z-[60] flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          enabled ? "bg-gold" : "bg-muted-foreground"
        }`}
      />
      {enabled ? "r10n: on" : "r10n: off"}
    </button>
  );
}
