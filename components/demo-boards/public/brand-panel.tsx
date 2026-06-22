"use client";

import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown, Check } from "lucide-react";
import type { BoardData } from "./demo-board-page";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/**
 * The branded Kracked rail — the conversion mechanism of the board. A calm,
 * confident column built entirely in our cream/navy/gold system: a bespoke hero,
 * a beautiful proof section, a "what happens on the call" reassurance, and a quiet
 * footer. The Book-a-call CTA is anchored to the bottom of the rail so it is always
 * in view as the prospect reads; on mobile it lives in a sticky book bar.
 */
export function BrandPanel({
  board,
  onBook,
  onTrack,
}: {
  board: BoardData["board"];
  onBook: () => void;
  onTrack: (type: string, metadata?: Record<string, unknown>) => void;
}) {
  const reduce = useReducedMotion();
  const firstName = board.contactName.split(" ")[0] || board.contactName;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sawBottom = useRef(false);

  // Scroll-depth tracking: fire once when the prospect reaches the bottom of the rail.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (sawBottom.current) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
        sawBottom.current = true;
        onTrack("scrolled_bottom");
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onTrack]);

  const stagger = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, ease: EASE_OUT, delay: 0.1 + i * 0.07 },
        };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-7 pt-8 lg:px-9 lg:pt-11"
      >
        {/* Header — wordmark + Email Demo badge */}
        <motion.div {...stagger(0)} className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-primary text-primary-foreground">
            <span className="font-heading text-sm font-bold tracking-tight">K</span>
          </div>
          <span className="font-heading text-[15px] font-semibold tracking-tight text-foreground">
            Kracked
          </span>
          <span className="ml-auto rounded-full border border-border bg-background/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Email Demo
          </span>
        </motion.div>

        {/* Hero — bespoke "Prepared for {FirstName}" */}
        <motion.div {...stagger(1)} className="mt-11">
          <div className="flex items-center gap-2.5">
            <span className="h-px w-7 bg-gold" aria-hidden />
            <span className="font-heading text-[12px] font-semibold uppercase tracking-[0.22em] text-gold-foreground">
              Prepared for
            </span>
          </div>
          <h1 className="mt-3 font-heading text-[40px] font-bold leading-[1.04] tracking-[-0.02em] text-foreground text-balance lg:text-[44px]">
            {firstName}
          </h1>
          {board.title && (
            <p className="mt-3.5 text-[13px] font-medium tracking-wide text-foreground/65">
              {board.title}
            </p>
          )}
          <p className="mt-5 max-w-[54ch] text-[15.5px] leading-[1.65] text-foreground/85">
            We designed this retention email from your live store, using your products and your
            brand voice. Look it over, then pick a time and we will show you how to turn it into
            real revenue.
          </p>
        </motion.div>

        {/* Proof — elegant expandable case studies, the numbers up front */}
        <motion.div {...stagger(2)} className="mt-11">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-[17px] font-semibold tracking-tight text-foreground">
              Proven results
            </h2>
            <span className="text-[12px] font-medium tracking-wide text-foreground/55">
              Real client outcomes
            </span>
          </div>
          <CaseStudies reduce={!!reduce} onTrack={onTrack} />
        </motion.div>

        {/* What happens on the call — friction-reducing reassurance */}
        <motion.div {...stagger(3)} className="mt-11">
          <h2 className="font-heading text-[17px] font-semibold tracking-tight text-foreground">
            What happens on the call
          </h2>
          <ol className="mt-4 space-y-px overflow-hidden rounded-[14px] border border-border bg-card">
            {CALL_STEPS.map((step, i) => (
              <li
                key={step.title}
                className={`flex items-start gap-3.5 px-4 py-3.5 ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/8 font-heading text-[12px] font-bold text-primary tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold leading-snug text-foreground">
                    {step.title}
                  </span>
                  <span className="mt-1 block max-w-[52ch] text-[13px] leading-relaxed text-foreground/70">
                    {step.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </motion.div>

        {/* Footer — quiet and refined */}
        <motion.div
          {...stagger(4)}
          className="mt-12 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pb-9 pt-6 text-[12px] tracking-wide text-foreground/55"
        >
          <span>© 2026 Kracked Retention</span>
          <a
            href="https://krackedretention.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground/70 underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            krackedretention.com
          </a>
          <span className="ml-auto tabular-nums text-foreground/45">{board.referenceCode}</span>
        </motion.div>
      </div>

      {/* Anchored CTA — the conversion point, always in view on desktop. */}
      <div className="hidden shrink-0 border-t border-border bg-card/90 px-7 pb-7 pt-6 backdrop-blur lg:block lg:px-9">
        <motion.div {...(reduce ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.5, ease: EASE_OUT, delay: 0.5 } })}>
          <p className="font-heading text-[18px] font-semibold leading-snug tracking-tight text-foreground">
            {board.bookedAt ? "Your call is booked" : "Book a 25-minute strategy call"}
          </p>
          <p className="mt-1.5 max-w-[48ch] text-[13.5px] leading-relaxed text-foreground/70">
            {board.bookedAt
              ? "We are looking forward to it. Tap below to see the details."
              : "Free, no pressure. One of our retention experts walks you through this design and where the revenue is."}
          </p>
          <div className="mt-4">
            <BookButton onClick={onBook} reduce={!!reduce} booked={!!board.bookedAt} />
          </div>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] font-medium tracking-wide text-foreground/55">
            <Check className="h-3.5 w-3.5 text-accent-green" />
            Trusted by 40+ DTC brands on Shopify and Klaviyo
          </p>
        </motion.div>
      </div>

      {/* Sticky mobile book bar — booking always one tap away when the panel scrolls. */}
      <div className="shrink-0 border-t border-border bg-card/90 px-7 py-3.5 backdrop-blur lg:hidden">
        <BookButton onClick={onBook} reduce={!!reduce} booked={!!board.bookedAt} compact />
      </div>
    </div>
  );
}

const CALL_STEPS: { title: string; body: string }[] = [
  {
    title: "We learn your store",
    body: "A few quick questions about your products, your customers, and where revenue leaks today.",
  },
  {
    title: "We map the opportunity",
    body: "You see exactly which flows and campaigns will move the needle, using this design as the start.",
  },
  {
    title: "You leave with a plan",
    body: "A clear next step, whether you build it in-house or hand it to us. No obligation either way.",
  },
];

function BookButton({
  onClick,
  reduce,
  booked,
  compact = false,
}: {
  onClick: () => void;
  reduce: boolean;
  booked: boolean;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-[12px] bg-primary text-[15px] font-semibold text-primary-foreground shadow-[0_14px_34px_-16px_rgba(15,58,92,0.7)] transition-transform duration-150 ease-out active:scale-[0.985] ${
        compact ? "px-5 py-3" : "px-5 py-3.5"
      }`}
    >
      {/* Sheen sweep — a single, slow, premium highlight that draws the eye to the CTA. */}
      {!reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-18deg] bg-white/18 blur-md"
          animate={{ x: ["0%", "420%"] }}
          transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity, repeatDelay: 3.2 }}
        />
      )}
      <Calendar className="h-[18px] w-[18px]" />
      {booked ? "View your call details" : "Book a call"}
    </button>
  );
}

/* ── Case studies ─────────────────────────────────────────────────────────── */

type CaseStudy = {
  name: string;
  meta: string;
  stats: { value: string; label: string }[];
  headline: string;
  description: string;
  results: { num: string; label: string }[];
  pillars: string[];
};

const CASE_STUDIES: CaseStudy[] = [
  {
    name: "California Naturals",
    meta: "Clean Beauty · DTC",
    stats: [
      { value: "81%", label: "List Growth" },
      { value: "16.6%", label: "Flow Revenue" },
      { value: "1,075+", label: "Conversions" },
    ],
    headline: "From Zero to Driving 16.6% of Automated Revenue from Email & SMS",
    description:
      "A clean beauty brand pivoted from wholesale to DTC in early 2025 with zero lifecycle infrastructure: no automated flows, no SMS program, all revenue dependent on manual sends. We deployed 12 automated flows, built their SMS channel from scratch adding 4,000+ subscribers in five months, and turned Klaviyo into a 24/7 revenue engine.",
    results: [
      { num: "81%", label: "Email list growth (27K to 49K)" },
      { num: "16.6%", label: "Average automated revenue from flows" },
      { num: "1,075+", label: "Automated conversions in 5 months" },
    ],
    pillars: ["Lifecycle Architecture", "SMS Channel Build", "Flow Optimization", "Attribution"],
  },
  {
    name: "Optimize Minerals",
    meta: "DTC Supplements · Subscription",
    stats: [
      { value: "40%", label: "Churn Drop" },
      { value: "6.2×", label: "Cancel Save" },
      { value: "471%", label: "Peak ROI" },
    ],
    headline: "How Optimize Minerals Cut Churn by 40% and Built a Retention System from Scratch",
    description:
      "A fast-growing supplement subscription brand with 15% churn, no cancel flow, and unreliable attribution. We built a reason-based cancel flow saving 29.2% of would-be cancellations, launched product-specific nurture flows for all three SKUs, replaced all default billing reminders months 1 to 13+, and deployed omnichannel abandonment flows that peaked at 471% ROI.",
    results: [
      { num: "40%", label: "Drop in 30-day churn rate (15% to 8.9%)" },
      { num: "6.2×", label: "Cancel flow save rate improvement" },
      { num: "471%", label: "Peak ROI on abandonment flows" },
    ],
    pillars: ["Cancel Flow Architecture", "Churn Reduction", "Post-Purchase Nurture", "Omnichannel"],
  },
  {
    name: "Fly By Jing",
    meta: "Food & Beverage · Omnichannel",
    stats: [
      { value: "53.6%", label: "Avg Open Rate" },
      { value: "334", label: "Campaigns" },
      { value: "44%", label: "Geo Open Rate" },
    ],
    headline: "How Fly By Jing Evolved from DTC Sensation to Retail Trailblazer",
    description:
      "A cult-favorite modern Chinese food brand expanding into Target, Whole Foods, Costco, and 8+ national retail partners. We unified DTC and retail marketing under one lifecycle system that drove product sellouts online while fueling retail awareness with geo-targeted campaigns, store-locator sends, and editorial-style creative that worked across every touchpoint.",
    results: [
      { num: "53.6%", label: "Average open rate across all sends" },
      { num: "334", label: "Campaigns executed 2024 to 2025" },
      { num: "44%", label: "Open rate on geo-targeted retail campaigns" },
    ],
    pillars: ["Omnichannel Strategy", "Retail Traffic", "Launch Excellence", "Creative Direction"],
  },
];

function CaseStudies({
  reduce,
  onTrack,
}: {
  reduce: boolean;
  onTrack: (type: string, metadata?: Record<string, unknown>) => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="mt-4 space-y-2.5">
      {CASE_STUDIES.map((cs, i) => {
        const open = openIndex === i;
        return (
          <div
            key={cs.name}
            className={`overflow-hidden rounded-[14px] border bg-card transition-colors duration-200 ${
              open
                ? "border-primary/25 shadow-[0_18px_44px_-34px_rgba(15,58,92,0.5)]"
                : "border-border"
            }`}
          >
            <button
              type="button"
              onClick={() => {
                const next = open ? null : i;
                setOpenIndex(next);
                if (next !== null) onTrack("case_study_opened", { name: cs.name });
              }}
              aria-expanded={open}
              className="flex w-full items-center gap-3 px-4 pt-4 pb-3.5 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-heading text-[14.5px] font-semibold tracking-tight text-foreground">
                  {cs.name}
                </span>
                <span className="mt-1 block truncate text-[11.5px] tracking-wide text-foreground/60">
                  {cs.meta}
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-foreground/50 transition-transform duration-300 ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>

            {/* Headline stats — always visible, the numbers sing. */}
            <div className="grid grid-cols-3 gap-2 px-4 pb-4">
              {cs.stats.map((s, si) => (
                <div
                  key={s.label}
                  className={`rounded-[10px] px-2 py-2.5 text-center ${
                    si === 0 ? "bg-primary/6" : "bg-muted/55"
                  }`}
                >
                  <span
                    className={`block font-heading text-[19px] font-bold leading-none tracking-tight tabular-nums ${
                      si === 0 ? "text-gold-foreground" : "text-primary"
                    }`}
                  >
                    {s.value}
                  </span>
                  <span className="mt-1.5 block text-[9px] font-medium uppercase tracking-[0.04em] leading-tight text-foreground/60">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  key="body"
                  initial={reduce ? { opacity: 1 } : { height: 0, opacity: 0 }}
                  animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                  exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.34, ease: EASE_OUT }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border px-4 pb-4 pt-4">
                    <p className="font-heading text-[14px] font-semibold leading-snug text-foreground">
                      {cs.headline}
                    </p>
                    <p className="mt-2.5 max-w-[58ch] text-[13px] leading-relaxed text-foreground/70">
                      {cs.description}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {cs.pillars.map((p) => (
                        <span
                          key={p}
                          className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[10px] font-medium tracking-wide text-foreground/65"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
