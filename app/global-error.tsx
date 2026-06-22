"use client";

import { useEffect } from "react";

/**
 * Root error boundary. Two jobs:
 *  1. Deployment-skew / chunk-load errors → self-heal with one hard reload
 *     (pulls the latest deployment's assets). Guarded against reload loops.
 *  2. Any other unhandled error → a calm, on-brand fallback instead of the bare
 *     "This page couldn't load" platform screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const msg = `${error?.name ?? ""} ${error?.message ?? ""}`;
  const isSkew =
    /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script/i.test(
      msg,
    );

  useEffect(() => {
    if (!isSkew) return;
    try {
      const KEY = "kr-skew-reload-at";
      const last = Number(sessionStorage.getItem(KEY) || "0");
      if (Date.now() - last < 10_000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* reload anyway */
    }
    window.location.reload();
  }, [isSkew]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: 380 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "1.5px solid #3a3a3a",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 18,
              fontSize: 20,
            }}
          >
            ⟳
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>
            {isSkew ? "Updating to the latest version…" : "Something went wrong"}
          </h1>
          <p style={{ fontSize: 13, color: "#a1a1a1", margin: "0 0 20px" }}>
            {isSkew
              ? "A new version just shipped — reloading you onto it."
              : "An unexpected error occurred. Try again, or reload."}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              onClick={() => reset()}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#fafafa",
                color: "#0a0a0a",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid #3a3a3a",
                background: "transparent",
                color: "#fafafa",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
