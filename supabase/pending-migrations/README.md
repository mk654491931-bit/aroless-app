# Pending migrations

SQL in this directory is **not** picked up by the Supabase CLI, which only
reads flat `.sql` files in `supabase/migrations`.

Files land here when a migration is correct but cannot be applied yet because
application code has to change first, or when it is optional hardening that is
not required for correctness.

To promote a file, move it into `supabase/migrations/` once its stated
prerequisite is met, then run `supabase db reset` locally to confirm the
ordering still applies cleanly.

| File | Status | Blocked on |
| --- | --- | --- |
| `20260908000100_lock_credit_columns.sql` | Optional defence-in-depth | Routing the inline refund closure in `gemini.functions.ts` through `tryRefundCredit()` / `refund_engine_credits()` |

### Why the credit lock is no longer urgent

The self-escalation hole it was written for is already closed by
`20260908002000_guard_profile_credit_changes.sql`, which bounds and audits
user-originated credit increases with a trigger instead of removing the grant.
That needed no application change, so it could ship immediately.

Applying the REVOKE as well would remove the direct-write path entirely, which
is stricter and slightly cheaper at runtime (no trigger on those updates). It is
worth doing eventually, but it is now an improvement rather than a fix.
