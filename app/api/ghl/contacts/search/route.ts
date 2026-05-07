import { NextRequest, NextResponse } from "next/server";
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
    const data = await ghl.get<{ contacts: GHLContact[] }>(
      `/contacts/?locationId=${locationId()}&query=${encodeURIComponent(q)}&limit=10`
    );

    const contacts = (data.contacts ?? []).map((c) => ({
      id: c.id,
      name: c.fullName ?? ([c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown"),
      email: c.email ?? null,
    }));

    return NextResponse.json({ contacts });
  } catch (err) {
    console.error("[GET /api/ghl/contacts/search]", err);
    return NextResponse.json({ contacts: [] });
  }
}
