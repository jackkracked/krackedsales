import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { replyTemplates } from "@/lib/db/schema";
import { count } from "drizzle-orm";

export const dynamic = "force-dynamic";

const SEED_TEMPLATES = [
  {
    name: "No Website",
    body: `I saw you didn't leave a website? Do you have a website for your brand? We can't do a demo unless you have an active website we can access.`,
    conditions: [
      { field: "has_website", operator: "equals", value: "false" },
    ],
    priority: 0,
    weight: 100,
  },
  {
    name: "Not a Fit — Non-DTC",
    body: `Appreciate you reaching out.

Quick heads up: our free email design offer is only for DTC / CPG e-commerce brands (Shopify + Klaviyo or Omnisend). That's where our systems are built to plug in directly. If you have an ecom brand you work with directly that you want to refer or white-label our services for we do offer that!

For service-based, local, or B2B businesses, the tools are usually different, so we're not able to implement this properly.

That said, I can invite you to our private Skool community, where we share the design templates, retention strategies, and email/SMS frameworks we use with our clients.
Want me to send you the invite?

I may also have a few people that are a better fit to help if you are open to some intros.`,
    conditions: [
      { field: "has_website", operator: "equals", value: "true" },
      { field: "brand_category", operator: "not_equals", value: "ecommerce" },
    ],
    priority: 1,
    weight: 100,
  },
];

export async function GET() {
  try {
    // Only seed if table is empty
    const [{ value }] = await db().select({ value: count() }).from(replyTemplates);
    if (value > 0) {
      return NextResponse.json({ message: "Already seeded", count: value });
    }

    const inserted = await db()
      .insert(replyTemplates)
      .values(SEED_TEMPLATES)
      .returning({ id: replyTemplates.id, name: replyTemplates.name });

    return NextResponse.json({ seeded: inserted });
  } catch (err) {
    console.error("[seed templates]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
