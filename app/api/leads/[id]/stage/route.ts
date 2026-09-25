import { NextRequest, NextResponse } from "next/server";
import { desc, eq, sql as sqlRaw } from "drizzle-orm";
import { db } from "@/lib/db";
import { localContacts, facebookLeads, META_LEAD_STAGES } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { ghl } from "@/lib/ghl/client";
import { sendQualifiedLead, STAGE_TO_META_EVENT } from "@/lib/meta/capi";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

/**
 * Set a lead's Meta stage. This is the single most consequential write in the app.
 *
 * Gage changing Meta's Leads Centre dropdown is what fires ~322 qualification events a month
 * on traffic costing $117-$337 per qualified lead. Meta exposes NO write API for that
 * dropdown, so once he works leads here instead, THIS ROUTE is the only thing telling
 * Facebook which leads were good.
 *
 * Order matters, and it is deliberate:
 *   1. Persist the stage       — the user's action must never be lost, whatever else fails
 *   2. Write back to GHL       — best effort; a GHL blip must not lose the stage
 *   3. Send the Meta event     — best effort; recorded either way so failure is VISIBLE
 *
 * Nothing here throws on a downstream failure. A stage change that "worked" in the UI but
 * silently dropped the signal is the exact failure mode this design exists to prevent, so
 * every outcome is written to capi_status and surfaced in the drawer.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { stage?: string };
  const stage = body.stage;

  if (!stage || !(META_LEAD_STAGES as readonly string[]).includes(stage)) {
    return NextResponse.json(
      { error: `stage must be one of: ${META_LEAD_STAGES.join(", ")}` },
      { status: 400 },
    );
  }

  const database = db();
  const [contact] = await database.select().from(localContacts).where(eq(localContacts.id, id)).limit(1);
  if (!contact) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const previous = contact.metaLeadStage;
  // Idempotent, but NOT blindly: re-selecting the same stage is a no-op only when Meta already
  // knows. If the last send failed or never ran, selecting the stage again is the user's only
  // way to retry, and swallowing it would lose the event permanently.
  //
  // "imported" counts as Meta already knowing. Those rows came FROM Meta's Leads Centre at
  // cutover (scripts/import-meta-stages.mjs), so Meta has the qualification already — it is
  // the source. Without this clause, re-clicking the stage Gage can already see on an
  // imported lead would send a duplicate event, and on the ~143 not_qualified rows that means
  // duplicate BAD signals telling the optimiser good leads are bad.
  const metaAlreadyKnows = contact.capiStatus === "sent" || contact.capiStatus === "imported";
  const stageNeedsSignal = Boolean(STAGE_TO_META_EVENT[stage]);
  if (previous === stage && (metaAlreadyKnows || !stageNeedsSignal)) {
    return NextResponse.json({ ok: true, stage, unchanged: true });
  }

  // ── 1. Persist first ────────────────────────────────────────────────────────────────
  await database
    .update(localContacts)
    .set({
      metaLeadStage: stage,
      metaLeadStageAt: new Date(),
      metaLeadStageBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(localContacts.id, id));

  // ── 2. GHL write-back (best effort) ─────────────────────────────────────────────────
  // Keeps GHL and this app agreeing on the lead's state. A failure here is logged, not fatal.
  //
  // TWO TRAPS, both found in review and both destructive if got wrong:
  //  1. local_contacts.id IS the GHL contact id. `locationId` is the sub-account id and is
  //     IDENTICAL for every contact — PUTting to it would 404 forever, silently.
  //  2. GHL REPLACES the tag array wholesale (see app/api/ghl/contacts/[contactId]/route.ts
  //     and lead-details-sidebar's editor, both of which send the full list). Sending only
  //     our tag would DELETE every source, campaign and automation tag on the contact, and
  //     lib/ghl/sync.ts would then mirror that wipe back into our DB. So we merge: strip any
  //     previous meta-stage-* tag, keep everything else, add the new one.
  let ghlSynced = false;
  try {
    const existing = Array.isArray(contact.tags) ? (contact.tags as string[]) : [];
    const preserved = existing.filter((t) => !t.startsWith("meta-stage-"));
    await ghl.put(`/contacts/${id}`, {
      tags: [...preserved, `meta-stage-${stage.replace(/_/g, "-")}`],
    });
    ghlSynced = true;
  } catch (err) {
    console.error(`[leads/stage] GHL write-back failed for ${id}:`, err);
  }

  // ── 3. The signal ───────────────────────────────────────────────────────────────────
  const eventName = STAGE_TO_META_EVENT[stage];
  let capi: { status: string; error?: string; eventId?: string } = { status: "skipped" };

  if (!eventName) {
    // An internal triage stage Meta has no history for. Deliberate silence, recorded as such.
    capi = { status: "skipped", error: `no Meta event mapped for "${stage}"` };
  } else {
    // Meta's own 15-17 digit lead id gives exact matching; without it we fall back to
    // hashed email + phone, which is Meta's documented alternative.
    const [meta] = contact.email
      ? await database
          .select({ leadgenId: facebookLeads.leadgenId })
          .from(facebookLeads)
          .where(sqlRaw`LOWER(${facebookLeads.email}) = LOWER(${contact.email})`)
          .orderBy(desc(facebookLeads.createdTime))
          .limit(1)
      : [];

    const result = await sendQualifiedLead({
      contactId: id,
      email: contact.email,
      phone: contact.phone,
      leadgenId: meta?.leadgenId ?? null,
      eventName,
      occurredAt: new Date(),
    });
    capi =
      result.status === "sent"
        ? { status: "sent", eventId: result.eventId }
        : { status: result.status, error: "error" in result ? result.error : result.reason };
  }

  // The receipt. Note capiSentAt is only overwritten on a NEW successful send — a later
  // "skipped" stage (e.g. moving a qualified lead to "lost") must not erase the proof that
  // Meta was once told. An unobservable signal is the failure mode this whole design exists
  // to prevent. Also stores the real Meta event id, not the event NAME, so it can be looked
  // up in Events Manager.
  await database
    .update(localContacts)
    .set({
      capiStatus: capi.status,
      capiError: capi.error ?? null,
      ...(capi.status === "sent"
        ? { capiSentAt: new Date(), capiEventId: capi.eventId ?? null }
        : {}),
    })
    .where(eq(localContacts.id, id));

  logActivity({
    userId: user.id,
    userName: user.name ?? user.email,
    userEmail: user.email,
    action: "lead.stage_changed",
    entityType: "contact",
    entityId: id,
    entityName: contact.fullName ?? contact.email ?? id,
    metadata: {
      from: previous ?? "untriaged",
      to: stage,
      metaEvent: eventName,
      capiStatus: capi.status,
      ghlSynced,
    },
  });

  return NextResponse.json({
    ok: true,
    stage,
    previous,
    ghlSynced,
    capi: { ...capi, event: eventName },
  });
}
