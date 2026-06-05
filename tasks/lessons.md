# Lessons

Observed problems and the rules that prevent them recurring.

## Project location & deploys
- **The real source is `~/Projects/kracked-sales`.** The folder
  `~/Documents/Agentic Workflows/Kracked Sales System/kracked-sales` is a stale
  bare Next.js starter — NOT the deployed app. Always work in `~/Projects`.
  (Real Node projects live outside iCloud.)
- **Production deploys are CLI uploads** (`vercel --prod`) from the working tree —
  there is no git-based deploy. The working tree carries a large amount of
  uncommitted work that is already in production. Before deploying, check the
  delta between the working tree and the last deploy (`find -newermt <deploy>`),
  don't assume the git diff vs last commit reflects what's unreleased.

## Build / env
- `.env.local` here holds only `VERCEL_OIDC_TOKEN` — no DB or API keys. So
  `next build` fails *locally* at page-data collection for any route that
  instantiates an SDK at module scope (e.g. `new Stripe(process.env.KEY!)` in
  `app/api/proposals/[id]/lost/route.ts`). This is an env limitation, not a code
  bug. Verify with `tsc --noEmit`; let Vercel (full env) run the real build. A
  failed Vercel build never aliases to production, so deploying to verify is safe.

## Auth middleware (proxy.ts)
- `proxy.ts` (Next 16 middleware) gates every route against `PUBLIC_PATHS`.
  Any unauthenticated server-to-server endpoint (Stripe/other webhooks, OAuth
  callbacks, cron) MUST be added to that allowlist or it 307-redirects to /login.
  Stripe's webhook was failing for exactly this reason — `/api/stripe/webhook`
  was missing from the list.
