import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactCustomFields } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const database = db();
    const fields = await database
      .select()
      .from(contactCustomFields)
      .where(eq(contactCustomFields.contactUid, id));
    return NextResponse.json({ fields });
  } catch (err) {
    console.error("[GET /api/contacts/[id]/custom-fields]", err);
    return NextResponse.json({ fields: [] }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { fieldName, fieldValue } = await req.json();

  if (!fieldName?.trim()) {
    return NextResponse.json({ error: "fieldName is required" }, { status: 400 });
  }

  try {
    const database = db();
    const [row] = await database
      .insert(contactCustomFields)
      .values({ contactUid: id, fieldName: fieldName.trim(), fieldValue: fieldValue ?? "" })
      .returning();
    return NextResponse.json({ field: row });
  } catch (err) {
    console.error("[POST /api/contacts/[id]/custom-fields]", err);
    return NextResponse.json({ error: "Failed to create field" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { fieldId, fieldValue } = await req.json();

  if (!fieldId) {
    return NextResponse.json({ error: "fieldId is required" }, { status: 400 });
  }

  try {
    const database = db();
    const [row] = await database
      .update(contactCustomFields)
      .set({ fieldValue: fieldValue ?? "" })
      .where(eq(contactCustomFields.id, fieldId))
      .returning();
    return NextResponse.json({ field: row });
  } catch (err) {
    console.error("[PATCH /api/contacts/[id]/custom-fields]", err);
    return NextResponse.json({ error: "Failed to update field" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { fieldId } = await req.json();

  if (!fieldId) {
    return NextResponse.json({ error: "fieldId is required" }, { status: 400 });
  }

  try {
    const database = db();
    await database
      .delete(contactCustomFields)
      .where(eq(contactCustomFields.id, fieldId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/contacts/[id]/custom-fields]", err);
    return NextResponse.json({ error: "Failed to delete field" }, { status: 500 });
  }
}
