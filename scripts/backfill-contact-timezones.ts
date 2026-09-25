/**
 * Assign a timezone to every contact we can place.
 *
 * DRY RUN BY DEFAULT. Pass --commit to write.
 *
 * Reads the phone number, and GoHighLevel's timezone where it is geographically possible for
 * that number. Writes nothing for a contact we cannot place: a null timezone is an honest
 * "we do not know", and the dialer stays silent on those rather than guessing.
 *
 * Safe to re-run: it recomputes from source each time and only writes rows that differ.
 */
import { db } from "@/lib/db";
import { localContacts } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { resolveContactZone } from "@/lib/dialer/calling-hours";

const COMMIT = process.argv.includes("--commit");

(async () => {
  const rows = await db().execute<{ id: string; phone: string | null; ghl_tz: string | null; timezone: string | null; timezone_source: string | null }>(sql`
    SELECT id, phone, raw_data->>'timezone' AS ghl_tz, timezone, timezone_source FROM local_contacts`);

  const counts = new Map<string, number>();
  let changed = 0, unplaceable = 0;

  for (const r of rows.rows) {
    const z = resolveContactZone({ phone: r.phone, ghlTimezone: r.ghl_tz });
    if (!z.timezone) {
      unplaceable++;
      // A number that USED to resolve and no longer does must lose its stale zone: a wrong
      // timezone is worse than an honest blank.
      if (r.timezone && COMMIT) {
        await db().update(localContacts).set({ timezone: null, timezoneSource: null })
          .where(eq(localContacts.id, r.id));
      }
      continue;
    }
    counts.set(z.confidence, (counts.get(z.confidence) ?? 0) + 1);
    // Compare the SOURCE too: a contact can keep its zone while the confidence changes, and a
    // stale "approximate" on a now-exact placing defeats the column's whole purpose.
    if (r.timezone === z.timezone && r.timezone_source === z.confidence) continue;
    changed++;
    if (COMMIT) {
      await db().update(localContacts)
        .set({ timezone: z.timezone, timezoneSource: z.confidence })
        .where(eq(localContacts.id, r.id));
    }
  }

  console.log(COMMIT ? "=== COMMITTED ===" : "=== DRY RUN ===");
  console.log(`contacts read       : ${rows.rows.length}`);
  console.log(`placed              : ${rows.rows.length - unplaceable}`);
  console.log(`unplaceable         : ${unplaceable}`);
  console.log(`rows ${COMMIT ? "written" : "that would be written"}: ${changed}`);
  console.log("\nby confidence:");
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
  if (!COMMIT) console.log("\nDry run. Re-run with --commit.");
})();
