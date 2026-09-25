/**
 * Is it a reasonable hour where this person actually is?
 *
 * Jack, 2026-09-25: "Kelsey accidentally dialed someone in Australia at 4:00 a.m. Our system
 * would recognise that, warn her, and then she can continue if she chooses to bypass that."
 *
 * THIS IS A WARNING, NEVER A BLOCK. Every path here ends in the rep deciding.
 *
 * ── What the data forced, measured against 6,083 live contacts on 2026-09-25 ──────────────
 *
 * The `country` field is useless: 5,794 of 5,797 say "US", including every Australian and UK
 * number we hold. Reading it would tell us everyone is American and the warning would never
 * fire for the exact case Jack described.
 *
 * GoHighLevel's own `timezone` field is present on 9% and is USUALLY plausible, but it claimed
 * Asia/Karachi, Europe/Copenhagen and Asia/Shanghai for ordinary US numbers, and put two
 * Australian numbers in the Americas. Cross-checked against area codes, 70 of 208 disagreed.
 * So it is believed only when it is geographically possible for the number's own country, which
 * keeps the genuine "moved and kept their mobile" cases and discards the nonsense.
 *
 * The phone number is the dependable signal: 3,879 of 3,881 carry a country code.
 *
 * ── The hours are law, not etiquette ─────────────────────────────────────────────────────
 * US (TCPA) 8am-9pm; Australia (ACMA) 9am-8pm weekdays, 9am-5pm Saturday, none Sunday;
 * UK 8am-9pm. Everywhere else 8am-9pm as a safe default.
 */

export type Confidence = "exact" | "area-code" | "country" | "approximate" | "unknown";

/** The five rulebooks an admin can edit. */
export const REGIONS = ["US", "CA", "AU", "GB", "OTHER"] as const;
export type Region = (typeof REGIONS)[number];

/** A window as [open, close) in local hours. 21.5 means 9:30pm. `null` means no calling at all. */
export type Window = [number, number] | null;

export interface RegionHours { weekday: Window; saturday: Window; sunday: Window }

/** What an admin has saved. A missing region falls back to the statutory default. */
export type CallingHoursConfig = Partial<Record<Region, RegionHours>>;

export const REGION_LABELS: Record<Region, string> = {
  US: "United States",
  CA: "Canada",
  AU: "Australia",
  GB: "United Kingdom",
  OTHER: "Everywhere else",
};

/**
 * The law as it stands, used whenever an admin has not overridden a region.
 *
 * These are statutory, not preferences: US TCPA, Canada CRTC, Australia ACMA. Shipping them as
 * the default means an untouched install is already compliant.
 */
export const STATUTORY: Readonly<Record<Region, RegionHours>> = Object.freeze({
  US:    { weekday: [8, 21],   saturday: [8, 21],  sunday: [8, 21] },
  CA:    { weekday: [9, 21.5], saturday: [10, 18], sunday: [10, 18] },
  AU:    { weekday: [9, 20],   saturday: [9, 17],  sunday: null },
  GB:    { weekday: [8, 21],   saturday: [8, 21],  sunday: [8, 21] },
  OTHER: { weekday: [8, 21],   saturday: [8, 21],  sunday: [8, 21] },
});

export interface CallingWindow {
  /** IANA zone used for the verdict, null when we could not tell. */
  timezone: string | null;
  /** Human place, e.g. "Sydney, Australia". Null when unknown. */
  place: string | null;
  confidence: Confidence;
  /** The prospect's local time, e.g. "4:12am". Null when unknown. */
  localTime: string | null;
  /** True when it is fine to call, or when we simply do not know enough to object. */
  allowed: boolean;
  /** Plain sentence naming the rule, e.g. "Calling is restricted to 9am-8pm there on weekdays." */
  rule: string | null;
}

/** Hours a country permits telemarketing, by day of week (0 = Sunday). */
interface Rules {
  label: string;
  /** [openHour, closeHour) in local time. A missing day means calling is not permitted at all. */
  byDay: Record<number, [number, number] | undefined>;
  sentence: (open: string, close: string) => string;
}

/** Zones that are Canadian, so the CRTC's stricter window applies. */
const CA_ZONES = /^(America\/(Toronto|Winnipeg|Regina|Edmonton|Vancouver|Halifax|Moncton|St_Johns|Whitehorse|Yellowknife|Dawson|Iqaluit|Thunder_Bay|Goose_Bay|Glace_Bay|Swift_Current|Creston|Fort_Nelson|Dawson_Creek|Atikokan|Blanc-Sablon|Rankin_Inlet|Resolute|Cambridge_Bay|Inuvik|Nipigon|Rainy_River)|Canada\/)/;

/**
 * Which rulebook applies.
 *
 * Routed by the resolved ZONE, because that is what survives to this point. Canada was
 * previously judged by the US window, which is looser at both ends: a Saturday 7pm call to
 * Toronto broke the CRTC rules and the dialog said nothing.
 */
export function regionForZone(timezone: string): Region {
  if (timezone.startsWith("Australia/") || timezone === "Pacific/Auckland") return "AU";
  if (CA_ZONES.test(timezone)) return "CA";
  if (timezone === "Europe/London") return "GB";
  if (/^(America\/|US\/|Pacific\/Honolulu|Pacific\/Guam|Pacific\/Pago_Pago)/.test(timezone)) return "US";
  return "OTHER";
}

/**
 * The window in force for a zone, on a given weekday.
 *
 * An admin's saved setting wins; anything they have not touched falls back to the statutory
 * window. A region saved as `null` for a day means "never call that day", which is how
 * Australia's Sunday ban is expressed and how an admin can add their own.
 */
function rulesFor(timezone: string, config?: CallingHoursConfig): Rules {
  const region = regionForZone(timezone);
  const hours = config?.[region] ?? STATUTORY[region];
  const dayWindow = (d: number): Window =>
    d === 0 ? hours.sunday : d === 6 ? hours.saturday : hours.weekday;
  return {
    label: "",
    byDay: { 0: dayWindow(0) ?? undefined, 1: dayWindow(1) ?? undefined, 2: dayWindow(2) ?? undefined,
             3: dayWindow(3) ?? undefined, 4: dayWindow(4) ?? undefined, 5: dayWindow(5) ?? undefined,
             6: dayWindow(6) ?? undefined },
    sentence: (o, c) => `Calling is restricted to ${o}-${c} there.`,
  };
}

/**
 * NANP area code to timezone.
 *
 * Grouped by zone rather than by state, because the zone is the only thing this file cares
 * about. An area code that is NOT here resolves to "approximate" and is judged against every
 * continental US zone at once, which means it only ever warns when the hour is unsociable
 * everywhere in the country. Being absent makes the warning quieter, never wrong.
 */
const EASTERN = "America/New_York", CENTRAL = "America/Chicago", MOUNTAIN = "America/Denver",
      ARIZONA = "America/Phoenix", PACIFIC = "America/Los_Angeles",
      ALASKA = "America/Anchorage", HAWAII = "Pacific/Honolulu",
      // Zones that do NOT follow their neighbours' daylight saving, so substituting a nearby
      // zone is wrong for months at a time.
      PUERTO_RICO = "America/Puerto_Rico",   // UTC-4, no DST
      SASKATCHEWAN = "America/Regina",       // UTC-6, no DST
      MICHIGAN = "America/Detroit",
      HALIFAX = "America/Halifax", MONCTON = "America/Moncton", NEWFOUNDLAND = "America/St_Johns";

const NANP_ZONES: Record<string, string> = {};
const assign = (zone: string, codes: string) => {
  for (const c of codes.split(/\s+/).filter(Boolean)) NANP_ZONES[c] = zone;
};

assign(EASTERN, `
  202 203 475 860 959 302 239 305 321 352 386 407 561 689 727 754 772 786 813 863 904 941 954
  229 404 470 478 678 706 762 770 912 260 317 463 574 765 812 930 606 859 207 240 301 410 443 667
  339 351 413 508 617 774 781 857 978 231 248 269 313 517 586 616 679 734 810 947 989 603
  201 551 609 640 732 848 856 862 908 973 212 315 332 347 516 518 585 607 631 646 680 716 718
  838 845 914 917 929 934 252 336 704 743 828 910 919 980 984 216 220 234 326 330 380 419 440
  513 567 614 740 937 215 223 267 272 412 445 484 570 610 717 724 814 878 401 803 839 843 854 864
  423 865 802 276 434 540 571 703 757 804 304 681

`);
assign(CENTRAL, `
  205 251 256 334 659 938 327 479 501 870 217 224 309 312 331 447 464 618 630 708 730 773 779
  815 847 872 219 319 515 563 641 712 316 620 785 913 270 364 225 318 337 504 985 218 320 507
  612 651 763 952 228 601 662 769 314 417 557 573 636 660 816 402 531 701 405 539 572 580 918
  605 615 629 731 901 931 308 502 850 448 210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806
  817 830 832 903 936 940 945 956 972 979 262 274 414 534 608 715 920
`);
assign(MOUNTAIN, `303 719 720 970 406 505 575 385 435 801 307 208 986 915`);
assign(ARIZONA, `480 520 602 623 928`);
assign(PACIFIC, `
  209 213 279 310 323 341 350 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707
  714 747 760 805 818 820 831 840 858 909 916 925 935 949 951 702 725 775 458 503 541 971
  206 253 360 425 509 564
`);
assign(ALASKA, `907`);
// Zones that keep their own clock, so a nearby substitute is wrong for months of the year.
assign(PUERTO_RICO, `787 939`);
assign(SASKATCHEWAN, `306 639 474`);
// CANADA GETS CANADIAN ZONES. Mapping these to their US equivalents meant rulesFor() could
// never tell a Canadian number from an American one, so the CRTC's tighter window (9am-9:30pm
// weekdays, 10am-6pm weekends) was never applied and a Saturday 7pm call to Toronto passed
// without a word.
assign("America/Toronto", `226 249 289 343 365 416 437 438 450 514 519 548 579 581 613 647 705 742 807 819 873 905 418 367 263 354 468 753 683`);
assign("America/Winnipeg", `204 431 584`);
assign("America/Edmonton", `403 587 780 825 368 867`);
assign("America/Vancouver", `236 250 604 672 778`);
assign(MICHIGAN, `906`);
// Atlantic Canada runs AHEAD of Eastern, so the US spread systematically under-warns it.
assign(HALIFAX, `902 782`);
assign(MONCTON, `506 428`);
assign(NEWFOUNDLAND, `709 879`);

assign("Pacific/Guam", `671 670`);
assign("Pacific/Pago_Pago", `684`);
assign("America/Puerto_Rico", `340`);
assign(HAWAII, `808`);

/** Calling code to timezone, for everywhere that is not the NANP. */
const COUNTRY_ZONES: Record<string, { zone: string; place: string; multi?: string[] }> = {
  "44": { zone: "Europe/London", place: "the UK" },
  // Australian LANDLINES carry the state in the digit after the country code, so those are
  // precise. Mobiles (+61 4xx) do not, and stay approximate: see AU_AREA below.
  "61": { zone: "Australia/Sydney", place: "Australia",
          multi: ["Australia/Perth", "Australia/Adelaide", "Australia/Sydney"] },
  "64": { zone: "Pacific/Auckland", place: "New Zealand" },
  "353": { zone: "Europe/Dublin", place: "Ireland" },
  "27": { zone: "Africa/Johannesburg", place: "South Africa" },
  "91": { zone: "Asia/Kolkata", place: "India" },
  "65": { zone: "Asia/Singapore", place: "Singapore" },
  "971": { zone: "Asia/Dubai", place: "the UAE" },
  "49": { zone: "Europe/Berlin", place: "Germany" },
  "33": { zone: "Europe/Paris", place: "France" },
  "34": { zone: "Europe/Madrid", place: "Spain" },
  "31": { zone: "Europe/Amsterdam", place: "the Netherlands" },
  "39": { zone: "Europe/Rome", place: "Italy" },
  "351": { zone: "Europe/Lisbon", place: "Portugal" },
  "46": { zone: "Europe/Stockholm", place: "Sweden" },
  "47": { zone: "Europe/Oslo", place: "Norway" },
  "45": { zone: "Europe/Copenhagen", place: "Denmark" },
  "48": { zone: "Europe/Warsaw", place: "Poland" },
  "52": { zone: "America/Mexico_City", place: "Mexico" },
  "55": { zone: "America/Sao_Paulo", place: "Brazil" },
  "63": { zone: "Asia/Manila", place: "the Philippines" },
};

/**
 * Australian landline prefixes. The single digit after +61 is the state, which makes a landline
 * exact and a mobile (+61 4) a genuine unknown within a three-hour spread.
 */
const AU_AREA: Record<string, { zone: string; place: string }> = {
  "2": { zone: "Australia/Sydney",    place: "Sydney, Australia" },
  "3": { zone: "Australia/Melbourne", place: "Melbourne, Australia" },
  "7": { zone: "Australia/Brisbane",  place: "Brisbane, Australia" },
  "8": { zone: "Australia/Perth",     place: "Western Australia" },
};

/** Every continental US zone, for the "we only know it is somewhere in America" case. */
const US_SPREAD = [EASTERN, CENTRAL, MOUNTAIN, PACIFIC];

/**
 * Zones a given country can actually be in.
 *
 * WHY NOT JUST THE CONTINENT
 * The first version accepted any `America/*` zone on a +1 number, which let GoHighLevel place a
 * Phoenix number in São Paulo (four hours out) and a Houston number in El Salvador. "America"
 * spans UTC-3 to UTC-10, so a continent check is barely a check at all. These are the zones
 * genuinely reachable for the country the phone number belongs to, and nothing else is believed.
 */
const ZONES_BY_COUNTRY: Record<string, (z: string) => boolean> = {
  NANP: (z) =>
    /^America\/(New_York|Detroit|Toronto|Chicago|Winnipeg|Regina|Denver|Edmonton|Phoenix|Boise|Los_Angeles|Vancouver|Anchorage|Juneau|Nome|Puerto_Rico|Halifax|Moncton|St_Johns|Indiana\/|Kentucky\/|North_Dakota\/|Menominee|Sitka|Yakutat|Metlakatla|Adak|Nassau|Iqaluit|Whitehorse|Yellowknife|Dawson|Rankin_Inlet|Resolute|Cambridge_Bay|Inuvik|Thunder_Bay|Nipigon|Rainy_River|Blanc-Sablon|Goose_Bay|Glace_Bay|Moncton|Swift_Current|Creston|Fort_Nelson|Dawson_Creek|Atikokan|Grand_Turk|Port-au-Prince|Santo_Domingo|Barbados|Jamaica|Cayman|Anguilla|Antigua|Dominica|Grenada|Guadeloupe|Martinique|Montserrat|Puerto_Rico|St_Kitts|St_Lucia|St_Thomas|St_Vincent|Tortola|Curacao|Aruba|Lower_Princes|Marigot|Port_of_Spain)/.test(z)
    || z === "Pacific/Honolulu" || /^US\//.test(z) || /^Canada\//.test(z),
  AU: (z) => z.startsWith("Australia/"),
  GB: (z) => z === "Europe/London",
};

/** An IANA zone the platform actually recognises. A bad string here throws inside Intl. */
function isRealZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const t = phone.trim().replace(/[^\d+]/g, "");
  if (!t.startsWith("+")) return null;

  // A NANP NUMBER THAT LOST ITS COUNTRY CODE.
  //
  // Ten contacts are stored as "+" plus ten digits: "+6463164592" is a New York number (646)
  // with the leading 1 missing. Read naively, +646 is New Zealand, so the dialog cheerfully
  // announced "It's 6:42am in Auckland" about someone in Manhattan. A false warning stated as
  // fact is exactly what destroys trust in the warning.
  //
  // Ten digits whose first three are a real NANP area code is unambiguous: no country code
  // plus national number legitimately takes that shape.
  const digitsOnly = t.slice(1);
  if (digitsOnly.length === 10 && NANP_ZONES[digitsOnly.slice(0, 3)]) return `+1${digitsOnly}`;
  return t;
}

/** Nicely formatted local time, e.g. "4:12am". */
export function localTimeIn(timezone: string, at: Date): string {
  try {
    return formatLocal(timezone, at);
  } catch {
    return "";
  }
}

function formatLocal(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(at).replace(/\s?([AP])M/, (_m, p) => (p === "A" ? "am" : "pm"));
}

/**
 * The local hour and weekday, or null if the platform would not tell us.
 *
 * RETURNS NULL RATHER THAN GUESSING. The first version defaulted a missing hour to 0 (because
 * `Number("") === 0`) and a missing weekday to Sunday. Both defaults mean "out of hours", and
 * for Australia a Sunday default warns on EVERY contact at EVERY hour with a sentence naming
 * the wrong day. A parsing failure has to fall to silence, which is the contract this whole
 * file is built on.
 */
function partsIn(timezone: string, at: Date): { hour: number; weekday: number } | null {
  let f: Intl.DateTimeFormatPart[];
  try {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hour: "numeric", minute: "2-digit", weekday: "short", hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    return null;
  }
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const rawHour = get("hour"), rawMin = get("minute"), rawDay = get("weekday");
  const hour = Number(rawHour), minute = Number(rawMin);
  const weekday = days[rawDay];
  if (rawHour === "" || !Number.isFinite(hour) || weekday === undefined) return null;
  // MINUTES COUNT. They were asked of Intl and then discarded, so a window closing at 9:30pm
  // was compared against the bare hour and 9:50pm read as 21 < 21.5 — allowed. The CRTC's
  // half-hour close, the one rule the Canadian rulebook exists for, was breached by up to 59
  // minutes in silence. Half-hour precision is offered in the UI, so it has to be real here.
  const mins = Number.isFinite(minute) ? minute : 0;
  // Some engines still render midnight as 24 even under h23.
  return { hour: (hour % 24) + mins / 60, weekday };
}

const hourLabel = (h: number) => {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  const base = whole === 0 ? "12" : whole <= 12 ? String(whole) : String(whole - 12);
  const suffix = whole < 12 ? "am" : "pm";
  return mins ? `${base}:${String(mins).padStart(2, "0")}${suffix}` : `${base}${suffix}`;
};

/** Is the given moment inside the country's permitted window, in that zone? */
function withinHours(timezone: string, at: Date, config?: CallingHoursConfig): { ok: boolean; rule: string } {
  const rules = rulesFor(timezone, config);
  const parts = partsIn(timezone, at);
  // Could not read the clock: say it is fine. Silence beats a false alarm.
  if (!parts) return { ok: true, rule: "" };
  const { hour, weekday } = parts;
  const window = rules.byDay[weekday];
  if (!window) {
    // NAME THE REAL DAY. This used to say "Sunday" whatever the day was, because Australia's
    // Sunday ban was the only case that existed. An admin can now switch off any day, and a
    // warning that says Sunday on a Saturday is a warning nobody trusts.
    const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return { ok: false, rule: `Calling is not permitted there on a ${DAY_NAMES[weekday]}.` };
  }
  const [open, close] = window;
  return {
    ok: hour >= open && hour < close,
    rule: rules.sentence(hourLabel(open), hourLabel(close)),
  };
}

export interface ResolveInput {
  phone: string | null | undefined;
  /** GoHighLevel's timezone field, believed only when it suits the number's country. */
  ghlTimezone?: string | null;
}

export interface Resolved {
  timezone: string | null;
  place: string | null;
  confidence: Confidence;
  /** Zones to test when we only know the rough region. Empty when `timezone` is definitive. */
  spread: string[];
}

/**
 * Work out where this number lives, and how sure we are.
 *
 * Order matters and is the opposite of what it first looked like: the phone number decides the
 * COUNTRY, and GoHighLevel is only allowed to refine the zone within that country.
 */
export function resolveContactZone({ phone, ghlTimezone }: ResolveInput): Resolved {
  const e164 = normalisePhone(phone);
  if (!e164) return { timezone: null, place: null, confidence: "unknown", spread: [] };

  const believable = (zone: string | null | undefined, country: string) => {
    if (!zone) return false;
    const test = ZONES_BY_COUNTRY[country];
    return !!test && test(zone) && isRealZone(zone);
  };

  // ── North America ───────────────────────────────────────────────────────────────────────
  if (e164.startsWith("+1") && e164.length >= 5) {
    const npa = e164.slice(2, 5);
    const byArea = NANP_ZONES[npa] ?? null;
    // GoHighLevel may legitimately know they MOVED, but only if it names an American zone.
    if (believable(ghlTimezone, "NANP")) {
      return { timezone: ghlTimezone!, place: placeFor(ghlTimezone!), confidence: "exact", spread: [] };
    }
    if (byArea) return { timezone: byArea, place: placeFor(byArea), confidence: "area-code", spread: [] };
    // An area code we do not hold: judged against the whole country at once. "North America"
    // rather than "the US", because this branch also catches Canadian and Caribbean numbers and
    // a warning that misstates the country is a warning nobody believes.
    return { timezone: EASTERN, place: "North America", confidence: "approximate", spread: US_SPREAD };
  }

  // ── Everywhere else ─────────────────────────────────────────────────────────────────────
  for (const len of [3, 2, 1]) {
    const code = e164.slice(1, 1 + len);
    const hit = COUNTRY_ZONES[code];
    if (!hit) continue;
    // A landline pins the state, and a deterministic prefix beats GoHighLevel, which disagreed
    // with area codes 70 times in 208.
    if (code === "61") {
      const area = AU_AREA[e164.slice(3, 4)];
      if (area) return { timezone: area.zone, place: area.place, confidence: "area-code", spread: [] };
    }
    const country = code === "61" ? "AU" : code === "44" ? "GB" : null;
    if (country && believable(ghlTimezone, country)) {
      return { timezone: ghlTimezone!, place: placeFor(ghlTimezone!), confidence: "exact", spread: [] };
    }
    if (hit.multi) {
      return { timezone: hit.zone, place: hit.place, confidence: "approximate", spread: hit.multi };
    }
    return { timezone: hit.zone, place: hit.place, confidence: "country", spread: [] };
  }

  return { timezone: null, place: null, confidence: "unknown", spread: [] };
}

/** "Australia/Sydney" → "Sydney, Australia". */
export function placeFor(zone: string): string {
  const segments = zone.split("/");
  const region = segments[0];
  // The LAST segment is the city: "America/Indiana/Indianapolis" and "America/Argentina/
  // Buenos_Aires" are three deep, and taking [1] named the state instead of the place.
  const city = segments.length > 1 ? segments[segments.length - 1] : null;
  if (!city) return zone;
  // "US/Eastern" and "Canada/Pacific" are legacy aliases naming a zone, not a city.
  if (region === "US" || region === "Canada") return `${city.replace(/_/g, " ")} time`;
  const nice = city.replace(/_/g, " ");
  const regions: Record<string, string> = {
    America: "", Europe: "", Australia: ", Australia", Asia: "", Africa: "", Pacific: "",
  };
  return regions[region] === undefined ? nice : `${nice}${regions[region]}`;
}

/**
 * The question the dialer asks before it connects a call.
 *
 * NEVER GUESSES. When the zone is unknown, or when we only know the rough region and the hour
 * is acceptable ANYWHERE in it, this returns `allowed: true` and the rep sees nothing. A
 * warning that cries wolf gets dismissed unread, and then it fails on the call that mattered.
 */
export function checkCallingHours(
  input: ResolveInput,
  now: Date = new Date(),
  config?: CallingHoursConfig,
): CallingWindow {
  const r = resolveContactZone(input);
  if (!r.timezone) {
    return { timezone: null, place: null, confidence: "unknown", localTime: null, allowed: true, rule: null };
  }

  // Where we only know the region, object only if EVERY plausible zone is out of hours.
  const zones = r.spread.length ? r.spread : [r.timezone];
  const verdicts = zones.map((z) => withinHours(z, now, config));
  const allowed = verdicts.some((v) => v.ok);

  return {
    timezone: r.timezone,
    place: r.place,
    confidence: r.confidence,
    localTime: localTimeIn(r.timezone, now),
    allowed,
    // The rule has to describe the zone whose CLOCK is on screen. Taking it from the first zone
    // of the spread produced "It's 12:30am ... not permitted on a Sunday" when it was Monday
    // where the displayed time came from, and an incoherent sentence has no authority.
    rule: allowed ? null : withinHours(r.timezone, now, config).rule || null,
  };
}
