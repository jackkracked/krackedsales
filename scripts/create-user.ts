/**
 * CLI script to create a new user account.
 *
 * Usage:
 *   npx tsx scripts/create-user.ts --name "Jack Smith" --email jack@example.com --password "your-password"
 */

import { db } from "../lib/db";
import { users } from "../lib/db/schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

async function main() {
  const args = process.argv.slice(2);

  function getArg(flag: string): string | undefined {
    const index = args.indexOf(flag);
    return index !== -1 ? args[index + 1] : undefined;
  }

  const name = getArg("--name");
  const email = getArg("--email");
  const password = getArg("--password");

  if (!name || !email || !password) {
    console.error(
      'Usage: npx tsx scripts/create-user.ts --name "Full Name" --email user@example.com --password "password"'
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existing = await db()
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existing.length > 0) {
    console.error(`A user with email "${normalizedEmail}" already exists.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [created] = await db()
    .insert(users)
    .values({ name, email: normalizedEmail, passwordHash })
    .returning({ id: users.id, name: users.name, email: users.email });

  console.log(`✓ User created: ${created.name} (${created.email}) — ID: ${created.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
