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
| _No pending migrations currently._ |  |  |
