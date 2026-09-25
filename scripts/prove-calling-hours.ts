/**
 * Proof for the dialer's calling-hours warning.
 *
 * Covers the rules, every boundary on both sides, daylight saving, the "do not guess" contract,
 * and the exact case Jack described: an Australian number dialled at 4am their time.
 *
 * Run: node_modules/.bin/tsx --env-file=.env.verify scripts/prove-calling-hours.ts
 */
import { checkCallingHours, resolveContactZone, localTimeIn, placeFor, regionForZone, STATUTORY } from "@/lib/dialer/calling-hours";

const pass: string[] = [], fail: string[] = [];
const ok = (n: string, c: boolean, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };

/** A moment expressed as wall-clock time IN a given zone, so tests read like real life. */
function momentIn(zone: string, iso: string): Date {
  // Binary-search a UTC instant whose rendering in `zone` matches the wanted wall clock.
  const want = iso;
  let lo = Date.parse(iso + "Z") - 20 * 3600_000, hi = Date.parse(iso + "Z") + 20 * 3600_000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const got = new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(mid)).replace(" ", "T");
    if (got < want) lo = mid; else hi = mid;
  }
  return new Date(Math.round(hi));
}

console.log("=== Jack's actual case: an Australian mobile at 4am their time ===");
const au4am = momentIn("Australia/Sydney", "2026-10-06T04:00");
const r1 = checkCallingHours({ phone: "+61412345678" }, au4am);
ok("warns", !r1.allowed, `${r1.localTime} in ${r1.place}`);
ok("shows their local time, not ours", r1.localTime === "4:00am", r1.localTime ?? "null");
ok("names the rule", !!r1.rule && r1.rule.includes("9am"), r1.rule ?? "none");

console.log("\n=== US boundaries, to the minute (TCPA 8am-9pm) ===");
const ny = (t: string) => checkCallingHours({ phone: "+12125550100" }, momentIn("America/New_York", `2026-10-06T${t}`));
ok("7:59am warns",        !ny("07:59").allowed);
ok("8:00am is fine",       ny("08:00").allowed);
ok("8:59pm is fine",       ny("20:59").allowed);
ok("9:00pm warns",        !ny("21:00").allowed);
ok("2:00pm is fine",       ny("14:00").allowed);
ok("3:00am warns",        !ny("03:00").allowed);

console.log("\n=== Australia's extra rules ===");
// A SYDNEY LANDLINE (+61 2) pins the state exactly, so the rules apply to the minute.
const syd = (d: string, t: string) => checkCallingHours({ phone: "+61298765432" }, momentIn("Australia/Sydney", `${d}T${t}`));
ok("Sunday is never allowed, even at 2pm", !syd("2026-10-04", "14:00").allowed, syd("2026-10-04","14:00").rule ?? "");
ok("Saturday 4pm is fine",                  syd("2026-10-03", "16:00").allowed);
ok("Saturday 6pm warns (closes at 5)",     !syd("2026-10-03", "18:00").allowed);
ok("Weekday 8:30pm warns (closes at 8)",   !syd("2026-10-06", "20:30").allowed);
ok("and a landline is resolved precisely, not approximated",
   resolveContactZone({ phone: "+61298765432" }).confidence === "area-code");

// A MOBILE could be anywhere in a three-hour spread, so it speaks only when the hour is
// unsociable across the whole country. Deliberate: a false alarm gets the warning ignored.
const mob = (d: string, t: string) => checkCallingHours({ phone: "+61412345678" }, momentIn("Australia/Sydney", `${d}T${t}`));
ok("mobile at 8:30pm Sydney stays quiet (6:30pm in Perth)", mob("2026-10-06", "20:30").allowed);
ok("mobile at 4am warns: unsociable everywhere in Australia", !mob("2026-10-06", "04:00").allowed);

console.log("\n=== Timezones are read from the number, not the country field ===");
ok("a +61 number is Australian", resolveContactZone({ phone: "+61412345678" }).timezone?.startsWith("Australia/") === true);
ok("a +44 number is British",    resolveContactZone({ phone: "+447700900123" }).timezone === "Europe/London");
ok("a New York area code is Eastern",  resolveContactZone({ phone: "+12125550100" }).timezone === "America/New_York");
ok("a Los Angeles area code is Pacific", resolveContactZone({ phone: "+13105550100" }).timezone === "America/Los_Angeles");
ok("Arizona does not observe daylight saving", resolveContactZone({ phone: "+16025550100" }).timezone === "America/Phoenix");

console.log("\n=== GoHighLevel is believed only when it is geographically possible ===");
ok("an American zone on a US number is trusted (they moved)",
   resolveContactZone({ phone: "+12025550100", ghlTimezone: "America/Los_Angeles" }).timezone === "America/Los_Angeles");
ok("Asia/Karachi on a US number is REJECTED",
   resolveContactZone({ phone: "+12315550100", ghlTimezone: "Asia/Karachi" }).timezone === "America/New_York");
ok("America/Toronto on an Australian number is REJECTED",
   resolveContactZone({ phone: "+61412345678", ghlTimezone: "America/Toronto" }).timezone?.startsWith("Australia/") === true);

console.log("\n=== It never guesses ===");
const noPhone = checkCallingHours({ phone: null });
ok("no phone: says nothing",        noPhone.allowed && noPhone.timezone === null);
const noCode = checkCallingHours({ phone: "5550100" });
ok("no country code: says nothing", noCode.allowed && noCode.timezone === null);
const unknownCountry = checkCallingHours({ phone: "+99912345678" });
ok("unrecognised country: says nothing", unknownCountry.allowed);

console.log("\n=== An unknown US area code is judged against the WHOLE country ===");
// 999 is not a real area code. 11am Eastern is 8am Pacific: fine somewhere, so stay quiet.
const spread1 = checkCallingHours({ phone: "+19995550100" }, momentIn("America/New_York", "2026-10-06T11:00"));
ok("11am Eastern (8am Pacific): stays quiet", spread1.allowed);
// 6am Eastern is 3am Pacific: unsociable everywhere, so speak up.
const spread2 = checkCallingHours({ phone: "+19995550100" }, momentIn("America/New_York", "2026-10-06T06:00"));
ok("6am Eastern (3am Pacific): warns", !spread2.allowed);

console.log("\n=== Daylight saving is handled by the platform, not by arithmetic ===");
const beforeDst = momentIn("America/New_York", "2026-11-01T07:30"); // EDT, 7:30am -> warns
const afterDst  = momentIn("America/New_York", "2026-11-02T07:30"); // EST, 7:30am -> warns
ok("7:30am warns either side of the clock change",
   !checkCallingHours({ phone: "+12125550100" }, beforeDst).allowed &&
   !checkCallingHours({ phone: "+12125550100" }, afterDst).allowed);
ok("and the time shown is still their wall clock",
   localTimeIn("America/New_York", afterDst) === "7:30am", localTimeIn("America/New_York", afterDst));

console.log("\n=== Regressions from the 2026-09-25 review ===");

// A NANP number stored without its leading 1. Ten of these are live; two were firing a false
// warning naming Auckland about people in New York.
ok("a +1 number missing its country code is NOT read as New Zealand",
   resolveContactZone({ phone: "+6463164592" }).timezone === "America/New_York",
   String(resolveContactZone({ phone: "+6463164592" }).timezone));
ok("and not as Australia either",
   resolveContactZone({ phone: "+6125550100" }).timezone === "America/Chicago",
   String(resolveContactZone({ phone: "+6125550100" }).timezone));

// GoHighLevel is believed per COUNTRY, not per continent.
ok("Sao Paulo on a Phoenix number is rejected",
   resolveContactZone({ phone: "+14803707044", ghlTimezone: "America/Sao_Paulo" }).timezone === "America/Phoenix");
ok("El Salvador on a Houston number is rejected",
   resolveContactZone({ phone: "+18327681269", ghlTimezone: "America/El_Salvador" }).timezone === "America/Chicago");
ok("Auckland on a US number is rejected",
   resolveContactZone({ phone: "+12125550100", ghlTimezone: "Pacific/Auckland" }).timezone === "America/New_York");
ok("a genuine relocation within the country is still trusted",
   resolveContactZone({ phone: "+12025550100", ghlTimezone: "America/Los_Angeles" }).timezone === "America/Los_Angeles");

// Timezones that keep their own clock.
const zoneOf = (p: string) => resolveContactZone({ phone: p }).timezone;
ok("906 is Eastern Michigan, not Central", zoneOf("+19065550100") === "America/Detroit");
ok("308 Nebraska is Central, not Mountain", zoneOf("+13085550100") === "America/Chicago");
ok("Puerto Rico keeps its own clock",      zoneOf("+17875550100") === "America/Puerto_Rico");
ok("Saskatchewan keeps its own clock",     zoneOf("+13065550100") === "America/Regina");
ok("Louisville is no longer missing",      zoneOf("+15025550100") === "America/Chicago");
ok("Halifax runs ahead of Eastern",        zoneOf("+19025550100") === "America/Halifax");

// Canada follows the CRTC, which is tighter than the US at both ends.
const toronto = (d: string, t: string) => checkCallingHours({ phone: "+14165550100" }, momentIn("America/Toronto", `${d}T${t}`));
ok("Saturday 7pm in Toronto warns (CRTC closes at 6)", !toronto("2026-10-03", "19:00").allowed, toronto("2026-10-03","19:00").rule ?? "");
ok("Tuesday 8:30am in Toronto warns (CRTC opens at 9)", !toronto("2026-10-06", "08:30").allowed);
ok("Tuesday 9:15pm in Toronto is fine (closes 9:30)",    toronto("2026-10-06", "21:15").allowed);

// A malformed zone must never throw out of the dial path.
let threw = false;
try { checkCallingHours({ phone: "+12125550100", ghlTimezone: "America/Nowhere_Real" }); } catch { threw = true; }
ok("a nonsense timezone does not throw", !threw);

// The rule sentence must describe the clock actually on screen.
const mondayEarly = checkCallingHours({ phone: "+61412345678" }, momentIn("Australia/Sydney", "2026-10-05T00:30"));
ok("the rule never names Sunday when the shown clock says Monday",
   !mondayEarly.rule || !mondayEarly.rule.includes("Sunday"), mondayEarly.rule ?? "none");

// Honest place labels.
ok("an unknown NANP code is not called \"the US\"",
   resolveContactZone({ phone: "+12045550100" }).place !== "the US");
ok("a three-segment zone names the city, not the state",
   placeFor("America/Indiana/Indianapolis") === "Indianapolis", placeFor("America/Indiana/Indianapolis"));

console.log("\n=== Admin-editable windows ===");

// An untouched install must behave exactly as the law requires.
ok("no config at all = the statutory window",
   !checkCallingHours({ phone: "+12125550100" }, momentIn("America/New_York", "2026-10-06T07:30"), {}).allowed);

// A narrowed window warns where the default would not.
const narrow = { US: { weekday: [10, 16] as [number, number], saturday: null, sunday: null } };
ok("narrowing to 10am-4pm warns at 9am",
   !checkCallingHours({ phone: "+12125550100" }, momentIn("America/New_York", "2026-10-06T09:00"), narrow).allowed);
ok("and stays quiet at 11am",
   checkCallingHours({ phone: "+12125550100" }, momentIn("America/New_York", "2026-10-06T11:00"), narrow).allowed);
ok("a day switched off warns all day",
   !checkCallingHours({ phone: "+12125550100" }, momentIn("America/New_York", "2026-10-03T13:00"), narrow).allowed);

// A widened window must genuinely widen, or the setting is decorative.
const wide = { AU: { weekday: [6, 23] as [number, number], saturday: [6, 23] as [number, number], sunday: [6, 23] as [number, number] } };
ok("widening Australia to 6am-11pm allows 8:30pm",
   checkCallingHours({ phone: "+61298765432" }, momentIn("Australia/Sydney", "2026-10-06T20:30"), wide).allowed);
ok("and Sunday becomes callable when an admin says so",
   checkCallingHours({ phone: "+61298765432" }, momentIn("Australia/Sydney", "2026-10-04T14:00"), wide).allowed);
ok("but 4am still warns, whatever the setting",
   !checkCallingHours({ phone: "+61298765432" }, momentIn("Australia/Sydney", "2026-10-06T04:00"), wide).allowed);

// Editing one region must not disturb another.
ok("changing the US leaves Australia on its own rule",
   !checkCallingHours({ phone: "+61298765432" }, momentIn("Australia/Sydney", "2026-10-06T20:30"), narrow).allowed);

// Regions resolve from the zone, so a number reaches the right rulebook.
ok("a Toronto number uses the Canadian rulebook", regionForZone("America/Toronto") === "CA");
ok("a New York number uses the US rulebook",      regionForZone("America/New_York") === "US");
ok("a Sydney number uses the Australian rulebook", regionForZone("Australia/Sydney") === "AU");
ok("a London number uses the UK rulebook",        regionForZone("Europe/London") === "GB");
ok("anywhere else falls to the catch-all",        regionForZone("Asia/Kolkata") === "OTHER");

console.log("\n=== Regressions from the settings review ===");

// H1: half-hour closes must be honoured to the minute.
const tor = (t: string) => checkCallingHours({ phone: "+14165550100" }, momentIn("America/Toronto", `2026-10-06T${t}`));
ok("Toronto 9:29pm is fine (CRTC closes 9:30)",  tor("21:29").allowed);
ok("Toronto 9:31pm warns",                      !tor("21:31").allowed);
ok("Toronto 9:50pm warns",                      !tor("21:50").allowed);
ok("Toronto 8:59am warns (opens at 9)",         !tor("08:59").allowed);
ok("Toronto 9:01am is fine",                     tor("09:01").allowed);

// A half-hour setting an admin types must behave to the minute too.
const half = { US: { weekday: [8.5, 17.5] as [number, number], saturday: null, sunday: null } };
const nyHalf = (t: string) => checkCallingHours({ phone: "+12125550100" }, momentIn("America/New_York", `2026-10-06T${t}`), half);
ok("a half-hour open is exact: 8:29am warns",   !nyHalf("08:29").allowed);
ok("and 8:31am is fine",                         nyHalf("08:31").allowed);
ok("a half-hour close is exact: 5:29pm is fine", nyHalf("17:29").allowed);
ok("and 5:31pm warns",                          !nyHalf("17:31").allowed);

// H2: a day switched off must name the day it means.
const satOff = { US: { weekday: [8, 21] as [number, number], saturday: null, sunday: [8, 21] as [number, number] } };
const satMsg = checkCallingHours({ phone: "+12125550100" }, momentIn("America/New_York", "2026-10-03T13:00"), satOff);
ok("Saturday switched off says Saturday, not Sunday",
   !satMsg.allowed && !!satMsg.rule && satMsg.rule.includes("Saturday"), satMsg.rule ?? "none");
ok("Australia's Sunday ban still says Sunday",
   (checkCallingHours({ phone: "+61298765432" }, momentIn("Australia/Sydney", "2026-10-04T14:00")).rule ?? "").includes("Sunday"));

// L2: the statutory table must not be mutable by anything downstream.
let frozen = true;
try { (STATUTORY as unknown as Record<string, unknown>).US = null; if (STATUTORY.US === null) frozen = false; } catch { /* frozen throws in strict mode */ }
ok("the statutory windows cannot be overwritten at runtime", frozen && STATUTORY.US?.weekday?.[0] === 8);

console.log(`\n=== RESULT: ${pass.length} passed, ${fail.length} failed ===`);
if (fail.length) { console.log("FAILED: " + fail.join(" | ")); process.exit(1); }
