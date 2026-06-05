/**
 * Regenerate stored call preps on the new research engine.
 *
 * Usage (needs DATABASE_URL + GEMINI_API_KEY in env — e.g. after `vercel env pull`):
 *   npx tsx scripts/regenerate-call-preps.ts desert      # only preps whose contact name matches "desert"
 *   npx tsx scripts/regenerate-call-preps.ts --all        # every stored prep
 *
 * Calls orchestrateCallPrep directly with force=true (the cron route has its own
 * skip guard, so it cannot be used for forced regeneration).
 */
import { db } from "@/lib/db";
import { callPreps } from "@/lib/db/schema";
import { orchestrateCallPrep } from "@/lib/call-prep";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const filter = process.argv[2];
  if (!filter) {
    console.error('Pass a name filter (e.g. "desert") or "--all".');
    process.exit(1);
  }

  const rows = await db()
    .select({
      calendarEventId: callPreps.calendarEventId,
      contactId: callPreps.contactId,
      contactName: callPreps.contactName,
    })
    .from(callPreps);

  const targets =
    filter === "--all"
      ? rows
      : rows.filter((r) =>
          (r.contactName ?? "").toLowerCase().includes(filter.toLowerCase()),
        );

  console.log(
    `Regenerating ${targets.length} prep(s)${filter !== "--all" ? ` matching "${filter}"` : ""}...\n`,
  );

  let ok = 0;
  let failed = 0;
  for (const t of targets) {
    console.log(`→ ${t.contactName ?? t.contactId} (${t.calendarEventId})`);
    try {
      const prep = await orchestrateCallPrep({
        calendarEventId: t.calendarEventId,
        contactId: t.contactId,
        contactName: t.contactName ?? undefined,
        force: true,
      });
      console.log(`  status: ${prep.status}`);
      if (prep.sections?.executiveSummary) {
        console.log(`  summary: ${prep.sections.executiveSummary}\n`);
      }
      ok++;
    } catch (e) {
      console.error(`  ✗ failed: ${e instanceof Error ? e.message : e}\n`);
      failed++;
    }
    await sleep(2000); // avoid grounding rate-limit spikes
  }

  console.log(`\n✓ Done. ${ok} regenerated, ${failed} failed.`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
