import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { ROLES } from "@/lib/auth/permission-constants";

export async function GET() {
  // Admin-only: this returns every user's name/email/role/ghlUserId. Non-admin roster needs go
  // through the trimmed GET /api/settings/team instead.
  const actor = await getSessionUser().catch(() => null);
  if (actor?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const all = await db()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      ghlUserId: users.ghlUserId,
      // Whether a DM can actually reach them. The task assignee picker shows this so an
      // admin is told at the moment of assigning, not after, when Slack will stay silent.
      hasSlack: users.slackUserId,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt);

  // The caller's own id, so a roster consumer can mark "Me" without a second request.
  return NextResponse.json({ users: all.map((u) => ({ ...u, hasSlack: !!u.hasSlack })), meId: actor.id });
}

export async function POST(req: NextRequest) {
  // Only admins may create users (and assign roles). Previously ungated + defaulted new users to
  // admin — a privilege-escalation hole.
  const actor = await getSessionUser().catch(() => null);
  if (actor?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, email, password, role } = await req.json();
  const roleValue = typeof role === "string" && (ROLES as readonly string[]).includes(role) ? role : "setter";

  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existing = await db()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [created] = await db()
    .insert(users)
    .values({ name: name.trim(), email: normalizedEmail, passwordHash, role: roleValue })
    .returning({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt });

  return NextResponse.json({ user: created }, { status: 201 });
}
