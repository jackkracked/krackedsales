-- 0036 Team salaries: monthly salary per role, pro-rated into Total Expenses. Additive + idempotent.

CREATE TABLE IF NOT EXISTS "team_salaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "role" text NOT NULL,
  "monthly_amount" double precision NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);
