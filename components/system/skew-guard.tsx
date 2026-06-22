"use client";

import { useEffect } from "react";

/**
 * SkewGuard — recovers from "deployment skew" without the dead "This page
 * couldn't load" screen.
 *
 * When a new version is deployed while a user has the app open, their browser
 * may try to load JS/CSS chunks that the new deployment no longer has. That
 * throws a ChunkLoadError / failed dynamic-import. We listen for exactly those
 * signatures and do ONE hard reload, which pulls the latest deployment's assets
 * — so the user transparently gets the new version instead of an error.
 *
 * A 10s sessionStorage guard prevents reload loops if something is genuinely
 * (not skew-) broken.
 */
const SKEW_SIGNATURES = [
  "ChunkLoadError",
  "Loading chunk",
  "Loading CSS chunk",
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
];

function isSkewError(...parts: Array<string | undefined>): boolean {
  const hay = parts.filter(Boolean).join(" ");
  return SKEW_SIGNATURES.some((sig) => hay.includes(sig));
}

function recover() {
  try {
    const KEY = "kr-skew-reload-at";
    const last = Number(sessionStorage.getItem(KEY) || "0");
    if (Date.now() - last < 10_000) return; // already tried — avoid a loop
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* sessionStorage unavailable — reload once anyway */
  }
  window.location.reload();
}

export function SkewGuard() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const err = e?.error as Error | undefined;
      if (isSkewError(e?.message, err?.name, err?.message)) recover();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e?.reason as (Error & { message?: string }) | string | undefined;
      const msg = typeof r === "string" ? r : r?.message;
      const name = typeof r === "string" ? undefined : (r as Error)?.name;
      if (isSkewError(msg, name)) recover();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
