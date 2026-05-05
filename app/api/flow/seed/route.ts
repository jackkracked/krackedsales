import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { flowNodes, flowEdges, replyTemplates } from "@/lib/db/schema";
import { count } from "drizzle-orm";

export const dynamic = "force-dynamic";

const NOT_FIT_BODY = `Appreciate you reaching out.

Quick heads up: our free email design offer is only for DTC / CPG e-commerce brands (Shopify + Klaviyo or Omnisend). That's where our systems are built to plug in directly. If you have an ecom brand you work with directly that you want to refer or white-label our services for we do offer that!

For service-based, local, or B2B businesses, the tools are usually different, so we're not able to implement this properly.

That said, I can invite you to our private Skool community, where we share the design templates, retention strategies, and email/SMS frameworks we use with our clients.
Want me to send you the invite?

I may also have a few people that are a better fit to help if you are open to some intros.`;

const SEED_TEMPLATES = [
  {
    key: "no-website", name: "No Website", priority: 0,
    conditions: [{ field: "has_website", operator: "equals", value: "false" }],
    body: `I saw you didn't leave a website? Do you have a website for your brand? We can't do a demo unless you have an active website we can access.`,
  },
  {
    key: "not-fit", name: "Not a Fit — Non-DTC", priority: 1,
    conditions: [{ field: "has_website", operator: "equals", value: "true" }, { field: "brand_category", operator: "not_equals", value: "ecommerce" }],
    body: NOT_FIT_BODY,
  },
  {
    key: "msg1", name: "Initial Outreach 1", priority: 2,
    conditions: [],
    body: `Hey it's Gage from Kracked Retention!`,
  },
  {
    key: "msg2", name: "Initial Outreach 2", priority: 3,
    conditions: [],
    body: `I just saw you filled out our Free email demo form.\n\nQuick favor, if you can reply "Got it" or 👍 so I know this came through!`,
  },
  {
    key: "msg3", name: "Platform Question", priority: 4,
    conditions: [],
    body: `Awesome! Couple of quick questions — are you currently using any specific email/SMS marketing tool? (e.g. Klaviyo, Omnisend, Mailchimp)`,
  },
  {
    key: "msg4", name: "Email Type Question", priority: 5,
    conditions: [],
    body: `Great! Last thing — for the free demo we normally do a welcome email, an abandoned cart email, or we can make it a surprise based on your site. Do you have a preference?`,
  },
  {
    key: "followup1", name: "Follow-up 1", priority: 6,
    conditions: [],
    body: `Hey! Just wanted to check in — did you get a chance to see my last message? Still happy to put together a free email demo for your store 🙌`,
  },
  {
    key: "followup2", name: "Follow-up 2", priority: 7,
    conditions: [],
    body: `Last follow-up, I promise — I know inboxes get busy! If you're still interested in the free email design, just reply and I'll get started right away. Otherwise, no worries at all! 😊`,
  },
];

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "true";
    const [{ value: nodeCount }] = await db().select({ value: count() }).from(flowNodes);
    if (nodeCount > 0 && !force) return NextResponse.json({ message: "Already seeded", nodeCount });

    // Wipe existing flow data before reseeding
    if (nodeCount > 0 && force) {
      await db().delete(flowEdges);
      await db().delete(flowNodes);
    }

    // Insert templates first
    const inserted = await db().insert(replyTemplates).values(
      SEED_TEMPLATES.map(({ key, name, body, conditions, priority }) => ({
        name, body, conditions, priority, weight: 100,
      }))
    ).returning({ id: replyTemplates.id, name: replyTemplates.name });

    const tById: Record<string, string> = {};
    for (let i = 0; i < SEED_TEMPLATES.length; i++) {
      tById[SEED_TEMPLATES[i].key] = inserted[i].id;
    }

    // ── Nodes ──────────────────────────────────────────────────────────────────
    const X = 350;   // main spine x
    const XL = -100; // left exits x
    const XR = 820;  // right follow-ups x

    const nodes = [
      // Main spine
      { id: "trigger",      type: "trigger",   positionX: X,   positionY: 0,    data: { label: "New Lead" },                          templateId: null },
      { id: "has-website",  type: "condition", positionX: X,   positionY: 150,  data: { label: "Has Website?" },                       templateId: null },
      { id: "is-dtc",       type: "condition", positionX: X,   positionY: 350,  data: { label: "Is DTC / Ecommerce?" },                templateId: null },
      { id: "msg1",         type: "message",   positionX: X,   positionY: 550,  data: { label: "Initial Outreach 1", immediate: false }, templateId: tById["msg1"] },
      { id: "msg2",         type: "message",   positionX: X,   positionY: 730,  data: { label: "Initial Outreach 2", immediate: true }, templateId: tById["msg2"] },
      { id: "replied-1",    type: "condition", positionX: X,   positionY: 930,  data: { label: "Prospect Replies?" },                  templateId: null },
      { id: "msg3",         type: "message",   positionX: X,   positionY: 1130, data: { label: "Platform Question" },                  templateId: tById["msg3"] },
      { id: "replied-2",    type: "condition", positionX: X,   positionY: 1330, data: { label: "Prospect Replies?" },                  templateId: null },
      { id: "msg4",         type: "message",   positionX: X,   positionY: 1530, data: { label: "Email Type Question" },                templateId: tById["msg4"] },
      { id: "replied-3",    type: "condition", positionX: X,   positionY: 1730, data: { label: "Prospect Replies?" },                  templateId: null },
      { id: "start-demo",   type: "action",    positionX: X,   positionY: 1930, data: { label: "Start Demo", actionType: "success" },  templateId: null },

      // Left exits
      { id: "no-website-msg", type: "message", positionX: XL, positionY: 280,  data: { label: "No Website" },     templateId: tById["no-website"] },
      { id: "no-website-end", type: "action",  positionX: XL, positionY: 460,  data: { label: "End", actionType: "dead-end" }, templateId: null },
      { id: "not-fit-msg",    type: "message", positionX: XL, positionY: 580,  data: { label: "Not a Fit" },      templateId: tById["not-fit"] },
      { id: "not-fit-end",    type: "action",  positionX: XL, positionY: 760,  data: { label: "End", actionType: "dead-end" }, templateId: null },

      // Right follow-ups — branch 1 (after replied-1)
      { id: "wait-1",       type: "action",  positionX: XR, positionY: 1000, data: { label: "Wait 24h", actionType: "wait", delay: "24h" },   templateId: null },
      { id: "fu1",          type: "message", positionX: XR, positionY: 1150, data: { label: "Follow-up 1" },                                   templateId: tById["followup1"] },
      { id: "fu-replied-1", type: "condition", positionX: XR, positionY: 1330, data: { label: "Replies?" },                                    templateId: null },
      { id: "wait-2",       type: "action",  positionX: XR, positionY: 1480, data: { label: "Wait 48h", actionType: "wait", delay: "48h" },    templateId: null },
      { id: "fu2",          type: "message", positionX: XR, positionY: 1620, data: { label: "Follow-up 2" },                                   templateId: tById["followup2"] },
      { id: "unresponsive", type: "action",  positionX: XR, positionY: 1780, data: { label: "Mark Unresponsive", actionType: "dead-end" },     templateId: null },

      // Right follow-ups — branch 2 (after replied-2)
      { id: "wait-3",         type: "action",  positionX: XR + 330, positionY: 1400, data: { label: "Wait 24h", actionType: "wait", delay: "24h" }, templateId: null },
      { id: "fu3",            type: "message", positionX: XR + 330, positionY: 1550, data: { label: "Follow-up 1" }, templateId: tById["followup1"] },
      { id: "unresponsive-2", type: "action",  positionX: XR + 330, positionY: 1710, data: { label: "Mark Unresponsive", actionType: "dead-end" }, templateId: null },

      // Right follow-ups — branch 3 (after replied-3)
      { id: "wait-4",         type: "action",  positionX: XR + 660, positionY: 1800, data: { label: "Wait 24h", actionType: "wait", delay: "24h" }, templateId: null },
      { id: "fu4",            type: "message", positionX: XR + 660, positionY: 1950, data: { label: "Follow-up 1" }, templateId: tById["followup1"] },
      { id: "unresponsive-3", type: "action",  positionX: XR + 660, positionY: 2110, data: { label: "Mark Unresponsive", actionType: "dead-end" }, templateId: null },
    ];

    // ── Edges ──────────────────────────────────────────────────────────────────
    const edges = [
      // Main spine — positive flow
      { id: "e-trigger-has-website",   source: "trigger",     target: "has-website",  sourceHandle: "out",     branchType: "positive", label: "" },
      { id: "e-hw-yes-is-dtc",         source: "has-website", target: "is-dtc",       sourceHandle: "yes",     branchType: "positive", label: "Has website" },
      { id: "e-dtc-yes-msg1",          source: "is-dtc",      target: "msg1",         sourceHandle: "yes",     branchType: "positive", label: "Is DTC" },
      { id: "e-msg1-msg2",             source: "msg1",        target: "msg2",         sourceHandle: "out",     branchType: "immediate", label: "Immediately" },
      { id: "e-msg2-replied1",         source: "msg2",        target: "replied-1",    sourceHandle: "out",     branchType: "positive", label: "" },
      { id: "e-replied1-yes-msg3",     source: "replied-1",   target: "msg3",         sourceHandle: "yes",     branchType: "positive", label: "Got it / 👍" },
      { id: "e-msg3-replied2",         source: "msg3",        target: "replied-2",    sourceHandle: "out",     branchType: "positive", label: "" },
      { id: "e-replied2-yes-msg4",     source: "replied-2",   target: "msg4",         sourceHandle: "yes",     branchType: "positive", label: "I use Klaviyo / X" },
      { id: "e-msg4-replied3",         source: "msg4",        target: "replied-3",    sourceHandle: "out",     branchType: "positive", label: "" },
      { id: "e-replied3-yes-demo",     source: "replied-3",   target: "start-demo",   sourceHandle: "yes",     branchType: "positive", label: "Welcome / Cart / etc." },

      // Left exits
      { id: "e-hw-no-nowebsite",       source: "has-website", target: "no-website-msg", sourceHandle: "no",   branchType: "negative", label: "No website" },
      { id: "e-nowebsite-end",         source: "no-website-msg", target: "no-website-end", sourceHandle: "out", branchType: "negative", label: "" },
      { id: "e-dtc-no-notfit",         source: "is-dtc",      target: "not-fit-msg",  sourceHandle: "no",     branchType: "negative", label: "Not DTC" },
      { id: "e-notfit-end",            source: "not-fit-msg", target: "not-fit-end",  sourceHandle: "out",    branchType: "negative", label: "" },

      // Follow-up branch 1
      { id: "e-replied1-no-wait1",     source: "replied-1",   target: "wait-1",       sourceHandle: "no",     branchType: "followup", label: "No reply" },
      { id: "e-wait1-fu1",             source: "wait-1",      target: "fu1",          sourceHandle: "out",    branchType: "followup", label: "" },
      { id: "e-fu1-fureplied",         source: "fu1",         target: "fu-replied-1", sourceHandle: "out",    branchType: "followup", label: "" },
      { id: "e-fureplied-yes-msg3",    source: "fu-replied-1", target: "msg3",        sourceHandle: "yes",    branchType: "positive", label: "Replies" },
      { id: "e-fureplied-no-wait2",    source: "fu-replied-1", target: "wait-2",      sourceHandle: "no",     branchType: "followup", label: "Still no reply" },
      { id: "e-wait2-fu2",             source: "wait-2",      target: "fu2",          sourceHandle: "out",    branchType: "followup", label: "" },
      { id: "e-fu2-unresponsive",      source: "fu2",         target: "unresponsive", sourceHandle: "out",    branchType: "negative", label: "" },

      // Follow-up branch 2
      { id: "e-replied2-no-wait3",     source: "replied-2",   target: "wait-3",       sourceHandle: "no",     branchType: "followup", label: "No reply" },
      { id: "e-wait3-fu3",             source: "wait-3",      target: "fu3",          sourceHandle: "out",    branchType: "followup", label: "" },
      { id: "e-fu3-unresponsive2",     source: "fu3",         target: "unresponsive-2", sourceHandle: "out",  branchType: "negative", label: "" },

      // Follow-up branch 3
      { id: "e-replied3-no-wait4",     source: "replied-3",   target: "wait-4",       sourceHandle: "no",     branchType: "followup", label: "No reply" },
      { id: "e-wait4-fu4",             source: "wait-4",      target: "fu4",          sourceHandle: "out",    branchType: "followup", label: "" },
      { id: "e-fu4-unresponsive3",     source: "fu4",         target: "unresponsive-3", sourceHandle: "out",  branchType: "negative", label: "" },
    ];

    await db().insert(flowNodes).values(nodes);
    await db().insert(flowEdges).values(edges);

    return NextResponse.json({ ok: true, nodes: nodes.length, edges: edges.length });
  } catch (err) {
    console.error("[flow seed]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
