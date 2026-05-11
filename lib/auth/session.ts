import { cookies } from "next/headers";
import { createHmac } from "crypto";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const SESSION_COOKIE = "kracked_session";

/** Extract and verify userId from the session cookie. Returns null if invalid. */
export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [userId, sig] = token.split("|");
  if (!userId || !sig) return null;

  const secret = process.env.SESSION_SECRET ?? "dev-secret-change-me";
  const expected = createHmac("sha256", secret).update(userId).digest("hex");
  if (sig !== expected) return null;

  return userId;
}

/** Fetch the current session user (id, name, email, role, ghlUserId). Returns null if not authed. */
export async function getSessionUser() {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const [user] = await db()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      ghlUserId: users.ghlUserId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}
