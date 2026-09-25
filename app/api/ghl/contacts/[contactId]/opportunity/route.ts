import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { localOpportunities, localPipelines, users } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity/logger";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const loc = locationId();

  try {
    const pipelinesData = await ghl.get<{ pipelines: GHLPipeline[] }>(
      `/opportunities/pipelines?locationId=${loc}`
    );

    // IDENTITY IS NEVER GUESSED.
    //
    // This endpoint decides which client the Inbox sidebar — and therefore the Create Demo,
    // Create Task and Create Audit quick actions — is acting on. Returning the wrong
    // opportunity means acting on the wrong client, so the ONLY acceptable match is an exact
    // contact-id match. If there isn't one, we return null and the UI falls back to the contact
    // we already know. A missing opportunity is a minor inconvenience; a wrong one messages
    // someone else's client.
    //
    // 2026-08-13 incident this replaces: Gage opened Alex (oobi.com.au) and the Create Demo
    // modal opened titled "for Schleepi", prefilled with schleepi.com, alex@schleepi.com and
    // Schleepi's phone. He corrected the brand fields by hand, but the contact and opportunity
    // ids underneath were still Schleepi's, so the "your demo is in the works" message was
    // delivered to Schleepi. Three separate fallbacks made that possible:
    //
    //   1. `(o) => o.contact?.id === contactId || o.id` — `|| o.id` is truthy for EVERY
    //      opportunity, so `.find()` returned the first item in the response and the contact-id
    //      test never actually ran.
    //   2. `?? byContact.opportunities[0]` — "if nothing matched, take the first one".
    //   3. A text search on the contact's NAME, then `?? byName.opportunities[0]`. Both clients
    //      here are "Alex", so the name search returned both and the wrong one was first.
    //
    // All three are gone. Do not reintroduce a positional fallback here.
    let opp: GHLOpportunity | null = null;
    // A swallowed search failure and a genuine "this contact has no opportunity" both end up as
    // `opp === null`, and both used to return 200. The caller could not tell them apart, so the
    // UI told reps a client had no deal when GoHighLevel had merely rate-limited us. Track it.
    let lookupFailed = false;

    const byContact = await ghl.get<{ opportunities: GHLOpportunity[] }>(
      `/opportunities/search?location_id=${loc}&contact_id=${encodeURIComponent(contactId)}&limit=20`
    ).catch((err) => {
      console.error("[opportunity] contact_id search failed", err);
      lookupFailed = true;
      return { opportunities: [] };
    });

    opp = byContact.opportunities?.find((o) => o.contact?.id === contactId) ?? null;

    // Strategy 2: GHL's contact_id filter can be unreliable, so a name search is still worth
    // trying — but ONLY to locate this contact's own opportunity. A result that does not carry
    // this exact contact id is someone else's and is discarded.
    if (!opp && name) {
      const byName = await ghl.get<{ opportunities: GHLOpportunity[] }>(
        `/opportunities/search?location_id=${loc}&q=${encodeURIComponent(name)}&limit=20`
      ).catch((err) => {
        console.error("[opportunity] name search failed", err);
        lookupFailed = true;
        return { opportunities: [] };
      });

      opp = byName.opportunities?.find((o) => o.contact?.id === contactId) ?? null;

      if (!opp && (byName.opportunities?.length ?? 0) > 0) {
        console.warn(
          `[opportunity] Name search for "${name}" returned ${byName.opportunities.length} result(s), ` +
            `none belonging to contact ${contactId}. Returning null rather than a wrong client.`,
        );
      }
    }

    if (!opp) return NextResponse.json({ opportunity: null, lookupFailed });

    // Enrich with stage name
    const pipeline = pipelinesData.pipelines?.find((p) => p.id === opp!.pipelineId);
    const stageName = pipeline?.stages?.find((s) => s.id === opp!.pipelineStageId)?.name ?? "Unknown";

    return NextResponse.json({
      opportunity: { ...opp, pipelineStageId_name: stageName },
      stageName,
    });
  } catch (err) {
    console.error("[GET /api/ghl/contacts/[id]/opportunity]", err);
    return NextResponse.json({ opportunity: null, lookupFailed: true }, { status: 500 });
  }
}


/**
 * POST — create an opportunity in GoHighLevel for a contact that has none, and mirror it locally.
 *
 * Deliberately NOT `POST /api/ghl/opportunities`, which cannot be reused here for two reasons:
 * it has no auth check at all, and it always creates a FRESH CONTACT, so pointing it at an
 * existing contact would duplicate them in GHL. This route only ever attaches to the contact in
 * the URL and never creates one.
 *
 * Creating an opportunity can fire GHL automations attached to the destination stage, and some of
 * those message the client. The UI confirms the pipeline and stage by name before calling this.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { contactId } = await params;
  // Shape gate. Next decodes the path segment, so without this a crafted id such as
  // `abc%26limit%3D0` arrives as `abc&limit=0` and injects extra parameters into the duplicate
  // check below, quietly disarming the one guard that stops a second deal being created.
  if (!contactId || !/^[A-Za-z0-9_-]{10,40}$/.test(contactId)) {
    return NextResponse.json({ error: "Invalid contact" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    pipelineId?: string;
    pipelineStageId?: string;
    name?: string;
    monetaryValue?: number | null;
    source?: string | null;
    assignedTo?: string | null;
  };

  const pipelineId = body.pipelineId?.trim();
  const pipelineStageId = body.pipelineStageId?.trim();
  const name = body.name?.trim();
  if (!pipelineId || !pipelineStageId) {
    return NextResponse.json({ error: "Pick a pipeline and a stage" }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "Give the opportunity a name" }, { status: 400 });
  if (name.length > 200) {
    return NextResponse.json({ error: "That name is too long" }, { status: 400 });
  }
  const source = body.source?.trim().slice(0, 100) || null;

  // Optional, but if present it must be a real, non-negative, plausible number. Infinity and NaN
  // are both rejected here; a bad value would be written to GHL as the deal's worth and then
  // reported as revenue.
  let monetaryValue = 0;
  if (body.monetaryValue != null) {
    const n = Number(body.monetaryValue);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
      return NextResponse.json({ error: "Deal value must be a positive number" }, { status: 400 });
    }
    monetaryValue = n;
  }

  const loc = locationId();
  const database = db();

  // ── The destination must be real, and it must be verified BEFORE the write ──────────────────
  // The whole point of the confirm step is that the rep is shown the destination stage by name.
  // If the server never checks that the id it received belongs to the pipeline it received, a
  // stale client (or any authenticated caller) can land the deal in a stage nobody confirmed and
  // fire that stage's client-facing automations.
  const pipeRow = await database
    .select({ name: localPipelines.name, stages: localPipelines.stages })
    .from(localPipelines)
    .where(eq(localPipelines.id, pipelineId))
    .limit(1);
  if (!pipeRow[0]) {
    return NextResponse.json({ error: "That pipeline no longer exists. Reload and try again." }, { status: 400 });
  }
  const stages = (pipeRow[0].stages as Array<{ id: string; name: string }> | null) ?? [];
  const stage = stages.find((st) => st.id === pipelineStageId);
  if (!stage) {
    return NextResponse.json({ error: "That stage is not in that pipeline. Reload and try again." }, { status: 400 });
  }

  // ── Owner. Never taken on trust from the client ─────────────────────────────────────────────
  // The picker is admin-only in the UI, but the UI is not the authorization boundary: without
  // this, any rep could replay the request and assign a deal to someone else, moving it in every
  // per-rep pipeline and rep-performance view.
  let assignedTo: string | null = user.ghlUserId ?? null;
  if (body.assignedTo && body.assignedTo !== user.ghlUserId) {
    if (user.role !== "admin") {
      return NextResponse.json({ error: "You can only create opportunities for yourself" }, { status: 403 });
    }
    const owner = await database
      .select({ ghlUserId: users.ghlUserId })
      .from(users)
      .where(eq(users.ghlUserId, body.assignedTo))
      .limit(1);
    if (!owner[0]) return NextResponse.json({ error: "Unknown owner" }, { status: 400 });
    assignedTo = body.assignedTo;
  }

  // ── Duplicate guard. NEVER FAILS OPEN. ──────────────────────────────────────────────────────
  // Two oracles, because neither alone is sufficient. The mirror is written synchronously by this
  // route so it is immediately consistent and catches a second click before GHL has indexed the
  // first. GHL's search is authoritative for anything created outside this app. A duplicate deal
  // fires the destination stage's automations a second time, so the client gets messaged twice.
  const mirrored = await database
    .select({ id: localOpportunities.id })
    .from(localOpportunities)
    .where(and(eq(localOpportunities.contactId, contactId), isNull(localOpportunities.deletedInGhlAt)))
    .limit(1);

  const findExisting = async (): Promise<GHLOpportunity | null> => {
    const search = await ghl.get<{ opportunities: GHLOpportunity[] }>(
      `/opportunities/search?location_id=${loc}&contact_id=${encodeURIComponent(contactId)}&limit=20`
    );
    // Same identity rule as the GET above: only an exact contact-id match counts.
    return search.opportunities?.find((o) => o.contact?.id === contactId) ?? null;
  };

  let existing: GHLOpportunity | null = null;
  try {
    existing = await findExisting();
  } catch (err) {
    console.error("[POST opportunity] duplicate check failed", err);
    return NextResponse.json(
      { error: "Couldn't check whether this contact already has an opportunity. Nothing was created." },
      { status: 503 },
    );
  }
  if (existing) {
    return NextResponse.json(
      { error: "This contact already has an opportunity, so a second one was not created.", opportunityId: existing.id },
      { status: 409 },
    );
  }
  // A mirror row with no matching GHL opportunity is a GHOST: the deal was deleted in GHL and the
  // daily reconcile has not swept it yet. Refusing here on the mirror alone would tell the rep
  // "this contact already has an opportunity" for up to 24 hours, which is both false and
  // impossible for them to fix. GHL has now said otherwise, so we go ahead.
  if (mirrored[0]) {
    console.warn(`[POST opportunity] ignoring ghost mirror row ${mirrored[0].id} for contact ${contactId}`);
  }

  // ── Create in GHL ───────────────────────────────────────────────────────────────────────────
  // postOnce, never post: a retried create is a duplicate deal. See lib/ghl/client.ts.
  let created: GHLOpportunity | null = null;
  const attemptStartedAt = Date.now();
  try {
    const res = await ghl.postOnce<{ opportunity: GHLOpportunity }>("/opportunities", {
      pipelineId,
      pipelineStageId,
      locationId: loc,
      contactId,
      name,
      status: "open",
      monetaryValue,
      ...(source ? { source } : {}),
      ...(assignedTo ? { assignedTo } : {}),
    });
    created = res.opportunity;
  } catch (err) {
    // The request may have SUCCEEDED and merely timed out on our side, so reporting failure
    // would invite a second click and a real duplicate. But "there is an opportunity here now"
    // does NOT prove we made it, and adopting someone else's deal would relabel it as ours.
    const status = (err as { status?: number })?.status ?? 0;
    if (status >= 400 && status < 500) {
      // Deterministic rejection. GHL created nothing, so anything present belongs to someone
      // else and must never be adopted.
      console.error("[POST opportunity] GHL rejected the create", err);
      return NextResponse.json({ error: "GoHighLevel rejected the new opportunity." }, { status: 502 });
    }
    console.error("[POST opportunity] create failed, checking whether it landed anyway", err);
    const found = await findExisting().catch(() => null);
    if (!found) {
      return NextResponse.json({ error: "GoHighLevel rejected the new opportunity." }, { status: 502 });
    }
    // Only ours if it did not exist before we started. The 5s slack absorbs clock skew between
    // this process and GHL. Anything older is a pre-existing deal that the duplicate check missed
    // because GHL's search index lags, and the honest answer there is 409, not "created".
    const bornNow =
      !!found.createdAt && new Date(found.createdAt).getTime() >= attemptStartedAt - 5_000;
    if (!bornNow) {
      return NextResponse.json(
        { error: "This contact already has an opportunity, so a second one was not created.", opportunityId: found.id },
        { status: 409 },
      );
    }
    created = found;
  }

  if (!created?.id) {
    return NextResponse.json({ error: "GoHighLevel returned no opportunity." }, { status: 502 });
  }
  // Identity is never guessed, on the way back out either.
  if (created.contact?.id && created.contact.id !== contactId) {
    console.error(
      `[POST opportunity] GHL returned opportunity ${created.id} for contact ` +
        `${created.contact.id}, not ${contactId}. Not mirrored.`,
    );
    return NextResponse.json({ error: "GoHighLevel returned a mismatched record." }, { status: 502 });
  }

  // ── Mirror locally ──────────────────────────────────────────────────────────────────────────
  // Without a row here the deal does not exist for this app until the next sync. `rawData` is
  // mandatory, not decorative: lib/pipeline/mirror-source.ts and lib/contacts/mirror-source.ts
  // both `continue` past any row whose rawData is null, so a row without it is invisible on the
  // board and in the contacts list even though it exists in GHL.
  const nowIso = new Date().toISOString();
  // Prefer what GHL reports over what we asked for. Identical for an ordinary create, since GHL
  // echoes the request back, but on the adopt path above `created` may be an opportunity we did
  // not build, and mirroring OUR requested stage and value over its real ones would misreport a
  // live deal until the next reconcile.
  const resolvedPipelineId = created.pipelineId ?? pipelineId;
  const resolvedStageId = created.pipelineStageId ?? pipelineStageId;
  const resolvedStatus = created.status ?? "open";
  const resolvedValue = created.monetaryValue ?? monetaryValue;
  const raw: Record<string, unknown> = {
    ...created,
    id: created.id,
    pipelineId: resolvedPipelineId,
    pipelineStageId: resolvedStageId,
    status: resolvedStatus,
    name: created.name ?? name,
    monetaryValue: resolvedValue,
    // The Contacts list groups opportunities by `rawData.contact.id` and drops any row without
    // it, which would leave the contact still looking opportunity-free and offering this button
    // again. Never rely on GHL echoing the contact object back.
    contact: created.contact ?? { id: contactId, name },
    assignedTo: created.assignedTo ?? assignedTo,
    createdAt: created.createdAt ?? nowIso,
    updatedAt: created.updatedAt ?? nowIso,
  };

  try {
    await database
      .insert(localOpportunities)
      .values({
        id: created.id,
        contactId,
        pipelineId: resolvedPipelineId,
        pipelineStageId: resolvedStageId,
        pipelineName: pipeRow[0].name,
        // Only trustworthy when GHL put it where we asked; an adopted deal may sit elsewhere.
        stageName: resolvedStageId === pipelineStageId ? stage.name : null,
        name: raw.name as string,
        status: resolvedStatus,
        monetaryValue: resolvedValue,
        assignedTo,
        source,
        contactName: created.contact?.name ?? name,
        contactEmail: created.contact?.email ?? null,
        contactPhone: created.contact?.phone ?? null,
        rawData: raw,
        createdAtGhl: new Date(raw.createdAt as string),
        updatedAtGhl: new Date(raw.updatedAt as string),
        syncedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: localOpportunities.id,
        // Deliberately does NOT write pipelineId/pipelineStageId/status/monetaryValue. If this
        // row already exists we may be looking at an opportunity we adopted rather than created,
        // and those values are what we ASKED for, not what GHL holds. Overwriting them would
        // report a won $12k deal as an open $0 one. Let reconcile carry the truth.
        set: {
          rawData: raw,
          syncedAt: new Date(),
          updatedAt: new Date(),
          deletedInGhlAt: null,
        },
      });
  } catch (err) {
    // The opportunity DOES exist in GHL at this point. Failing the request would tell the rep it
    // did not and invite a second attempt, so we succeed and let the next sync fill the mirror.
    console.error("[POST opportunity] created in GHL but local mirror write failed", err);
  }

  logActivity({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    action: "opportunity.created",
    entityType: "opportunity",
    entityId: created.id,
    entityName: raw.name as string,
    metadata: { contactId, pipelineId, pipelineStageId, monetaryValue, source },
  });

  return NextResponse.json({ opportunity: { ...created, ...raw } }, { status: 201 });
}
