"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Scrolls the page's own scrollable container to the top on every navigation.
 * Must be rendered inside the page's root element (the one with overflow-y-auto).
 */
export function ScrollToTop() {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Walk up from this element to find the first scrollable ancestor
    let el: HTMLElement | null = ref.current?.parentElement ?? null;
    while (el) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        el.scrollTo({ top: 0 });
        return;
      }
      el = el.parentElement;
    }
    // Fallback: scroll window
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return <div ref={ref} style={{ display: "none" }} aria-hidden />;
}
