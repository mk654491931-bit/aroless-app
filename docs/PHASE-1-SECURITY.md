# Phase 1 -- Payment integrity, RLS and commission RBAC

This document records what was found during the Phase 1 audit of the Aroless
codebase, what this branch changes, and what still has to be done by hand.
It is deliberately blunt: the items under "Act now" are exploitable today.

---

## Act now (not fixable by code alone)

### 1. Leaked Paddle credentials -- rotate immediately

`.env` was committed to this **public** repository. `.gitignore` covered
`*.local` and `.dev.vars` but never `.env`.

Per `src/lib/paddle.server.ts`, that file carries at least:

- `PADDLE_API_KEY` -- Paddle Billing API key
- `PADDLE_WEBHOOK_SECRET_KEY` -- webhook signing secret
- `PADDLE_CLIENT_TOKEN` -- public by design, low risk

`resolvePaddleEnvironment()` treats anything without a `test_` / `_sdbx_`
marker as **production**, so assume these were live keys.

This branch stops tracking `.env` and ignores it going forward, but the values
remain readable in earlier commits. Required manual steps:

1. Rotate the Paddle API key and webhook secret in the Paddle dashboard.
2. Rotate the Supabase `service_role` key if it was ever present in `.env`.
3. Re-enter the new values in Vercel / Lovable environment settings only.
4. Make the repository private.
5. Optionally scrub history -- but note `AGENTS.md` warns that rewriting
   published history breaks the connected Lovable project history. Rotation is
   the safe fix; history rewriting is not required once the keys are dead.

---

## Findings

### Already correct -- no change needed

Webhook idempotency was **already well built** and did not need repair:

- Signature is verified with the official SDK before any business logic.
- `processed_webhook_events` gives replay protection on `event_id`.
- `process_paddle_event()` performs dedupe, ledger upsert, profile mirror,
  credit grant and promo conversion in a single Postgres transaction, so a
  Paddle retry after a partial failure cannot double-grant credits.
- The function is `SECURITY DEFINER` with `EXECUTE` granted to `service_role`
  only, and `processed_webhook_events` has RLS on with no user policies.
- `transactions_paddle_external_unique` dedupes payments independently.

### Fixed in this branch

**Out-of-order lifecycle events.** `process_paddle_event()` applied every
lifecycle event unconditionally. Paddle does not guarantee ordering, so a
delayed `subscription.canceled` arriving after a newer `subscription.activated`
would downgrade a paying customer (and the reverse could restore access to a
cancelled one).

`subscriptions.last_event_at` is now a monotonic watermark. A lifecycle event
older than the watermark is still recorded for audit and dedupe, then returns
`'stale'` without mutating state. Events carrying a transaction id are never
skipped, so no payment or credit grant can be lost to the guard.

**No commission system existed.** The 30% recurring micro-influencer
programme had no implementation at all -- a repository-wide search for
`commission` returns only unit-economics and i18n copy. `referral.functions.ts`
is a different, much smaller feature: 1 credit per invite, capped at 2 invites.

This branch adds the schema foundation with RBAC enforced in the database:

| Object | Guarantee |
| --- | --- |
| `affiliates` | `status` in pending/verified/suspended; rate capped at 50% by CHECK |
| `commission_events` | append-only; `UNIQUE (transaction, affiliate)` blocks double payment |
| RLS | `authenticated` can `SELECT` own rows only; no write path exists |
| `accrue_affiliate_commission()` | `service_role` only; re-checks `verified` in-database |
| `reverse_affiliate_commission()` | `service_role` only; refunds flip to `reversed`, never deleted |
| `set_affiliate_status()` | only authenticated-callable entry point; raises unless `has_role(auth.uid(),'admin')` |

Because the verified check lives inside a `SECURITY DEFINER` function rather
than in application code, a user calling the Supabase REST API directly still
cannot self-verify, alter their rate, or insert an accrual.

---

## Open findings -- not yet fixed

### 1. Credit self-escalation (revenue bypass, high severity)

`20260907000000_paddle_production_ready.sql` revokes column-level `UPDATE` on
the entitlement columns but **intentionally leaves `credits` and `sim_credits`
writable by `authenticated`**, because the engine-failure refund paths in
`gemini.functions.ts` and `error-helpers.ts` update them through the
user-scoped client.

Combined with the table-wide `UPDATE` grant and a self-update RLS policy on
`profiles`, any logged-in user can run the following from the browser and mint
unlimited paid AI credits:

```js
await supabase.from('profiles').update({ credits: 999999 }).eq('id', myId)
```

The fix cannot be a bare `REVOKE`: that would break the refund feature, and
Phase 1's rule is that no existing behaviour may be lost. The sequenced fix is
staged in `supabase/pending-migrations/20260908000100_lock_credit_columns.sql`
and must be applied **after** the refund call sites are moved to the
`refund_engine_credits()` RPC defined in that same file. Do not apply it
before that code change.

### 2. Refund and chargeback events are never handled

`mapPaddleEvent()` in `src/lib/paddle.server.ts` handles only subscription
lifecycle events and `transaction.completed`. There is no mapping for
`transaction.refunded`, `transaction.payment_failed` or `adjustment.created`,
so a refunded customer keeps both their tier and the granted credits.

`reverse_affiliate_commission()` is in place for the commission side; the
TypeScript mapping and an entitlement-revocation path still have to be written.

### 3. `is_designated_admin()` is fragile

In `20260827_100000_harden_admin_and_security.sql`, the `@aroless.com`
"first two accounts are admin" branch uses `COUNT(*)` with `GROUP BY 1`. When
the subquery matches no rows the aggregate yields `NULL`, making
`RETURN NULL <= 2` evaluate to `NULL`, which the caller treats as false. The
logic works by accident rather than by design and should be rewritten with an
explicit `COALESCE` and no `GROUP BY`.

The function is also `STABLE` but not `SECURITY DEFINER` while reading
`public.profiles`, so it executes under the caller's RLS context.

---

## Verification status -- read this before merging

These changes were written from a static read of the repository. They have
**not** been executed:

- `supabase db reset` / `supabase migration up` has not been run against a
  local or staging database.
- `bun run typecheck`, `bun run lint` and `vitest` have not been run.

Before merging, please run, against **staging** first:

```bash
supabase db reset          # migration applies cleanly, in order
bun run typecheck
bun run lint
bun run test
```

Suggested manual checks once applied:

1. Replay the same Paddle `event_id` twice -- second call returns `duplicate`,
   credits granted once.
2. Send `subscription.activated` (t=10) then `subscription.canceled` (t=5) --
   the second returns `stale` and the tier survives.
3. As a non-admin, call `set_affiliate_status` -- expect `42501 forbidden`.
4. As a non-admin, attempt `INSERT` into `commission_events` -- expect denial.
5. Accrue for a `pending` affiliate -- expect `skipped_not_verified`.
