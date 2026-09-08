# Pending migrations

SQL in this directory is **not** picked up by the Supabase CLI, which only
reads flat `.sql` files in `supabase/migrations`.

Files land here when a migration is correct but cannot be applied yet because
application code has to change first. Applying one early would break a live
feature, which Phase 1 does not allow.

To promote a file, move it into `supabase/migrations/` once its stated
prerequisite is merged, then run `supabase db reset` locally to confirm the
ordering still applies cleanly.

| File | Blocked on |
| --- | --- |
| `20260908000100_lock_credit_columns.sql` | Moving the client-side credit-refund calls in `gemini.functions.ts` and `error-helpers.ts` onto the `refund_engine_credits()` RPC |
