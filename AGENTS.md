# Aroless — working agreements

## Deployment

Vercel is the only supported target. `nitro.config.ts` pins the `vercel` preset
and every server function and `/api` route ships as a Vercel function out of
`npm run build`. There is no editor-hosted publish path and no Cloudflare
fallback; see `docs/VERCEL-DEPLOYMENT.md` for the required environment
variables.

All secrets come from Vercel project environment variables. `.env` is for local
development only and is git-ignored — never commit it.

## Git

Avoid rewriting published history (force pushing, rebasing, amending or
squashing commits that are already pushed). Not for any vendor's sake: this repo
is reviewed through stacked pull requests, and rewriting a pushed branch
invalidates in-flight review comments and anything already deployed from that
SHA. Keep every pushed branch in a working state.

## Tests

`npm run typecheck && npm test` must pass before a PR leaves draft. Pure logic
belongs in a dependency-free module with unit tests (see
`src/lib/dashboard-metrics.ts`, `src/lib/paddle-refunds.server.ts`,
`src/lib/search-handoff.ts`) rather than inline in a component or a route.

## Money and credits

Paddle webhook handling, credit grants, refunds and affiliate commission are
enforced in the database, not in the client. Never add a client-side path that
writes `profiles.credits` or `profiles.sim_credits` directly — the
`trg_guard_profile_credit_changes` trigger will reject it. Route refunds through
`refund_engine_credits()` and see `docs/PHASE-1-SECURITY.md`.
