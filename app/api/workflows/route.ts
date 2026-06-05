import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db()
    .select({
      id: workflows.id,
      name: workflows.name,
      description: workflows.description,
      enabled: workflows.enabled,
      createdAt: workflows.createdAt,
      updatedAt: workflows.updatedAt,
    })
    .from(workflows)
    .orderBy(desc(workflows.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  const { name, description } = (await req.json()) as {
    name?: string;
    description?: string;
  };
  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const [row] = await db()
    .insert(workflows)
    .values({
      name: name.trim(),
      description: description?.trim() ?? null,
      createdBy: user?.id ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
