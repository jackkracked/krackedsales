import { NextRequest, NextResponse } from "next/server";
import { or, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { localContacts } from "@/lib/db/schema";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q || q.length < 2) {
    return NextResponse.json({ contacts: [] });
  }

  try {
    // Step 1: query local Neon DB first
    const pattern = `%${q}%`;
    const rows = await db()
      .select({
        id: localContacts.id,
        fullName: localContacts.fullName,
        firstName: localContacts.firstName,
        lastName: localContacts.lastName,
        email: localContacts.email,
      })
      .from(localContacts)
      .where(
        or(
          ilike(localContacts.fullName, pattern),
          ilike(localContacts.email, pattern),
          ilike(localContacts.phone, pattern),
          ilike(localContacts.companyName, pattern)
        )
      )
      .limit(10);

    if (rows.length > 0) {
      const contacts = rows.map((c) => ({
        id: c.id,
        name:
          c.fullName ??
          ([c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown"),
        email: c.email ?? null,
      }));
      return NextResponse.json({ contacts });
    }

    // Step 2: fall back to GHL if local returned nothing
    const data = await ghl.get<{ contacts: GHLContact[] }>(
      `/contacts/?locationId=${locationId()}&query=${encodeURIComponent(q)}&limit=10`
    );

    const contacts = (data.contacts ?? []).map((c) => ({
      id: c.id,
      name:
        c.fullName ??
        ([c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown"),
      email: c.email ?? null,
    }));

    return NextResponse.json({ contacts });
  } catch (err) {
    console.error("[GET /api/ghl/contacts/search]", err);
    return NextResponse.json({ contacts: [] });
  }
}
