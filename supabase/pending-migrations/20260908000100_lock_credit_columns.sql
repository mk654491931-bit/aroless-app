-- ============================================================================
-- STAGED -- DO NOT APPLY YET
--
-- Closes the credit self-escalation hole described in docs/PHASE-1-SECURITY.md:
--
--   await supabase.from('profiles').update({ credits: 999999 }).eq('id', myId)
--
-- The replacement RPC (refund_engine_credits) already ships in
-- 20260908001000_refund_handling_and_admin_hardening.sql, and
-- src/lib/error-helpers.ts already calls it with a legacy fallback, so the
-- refund feature keeps working before AND after this file is applied.
--
-- PREREQUISITE: the inline refund closure in src/lib/gemini.functions.ts still
-- writes profiles.credits directly through the user-scoped client. Route it
-- through tryRefundCredit() / refund_engine_credits() first, otherwise that one
-- path will start failing silently (it is wrapped in a bare try/catch).
--
-- Promote by moving this file into supabase/migrations/ once that call site is
-- converted, then run `supabase db reset` to verify ordering.
-- ============================================================================

REVOKE UPDATE (credits, sim_credits) ON public.profiles FROM authenticated;

COMMENT ON COLUMN public.profiles.credits IS
  'Search credits. Not directly writable by authenticated users -- use refund_engine_credits() or a service_role path.';
COMMENT ON COLUMN public.profiles.sim_credits IS
  'Simulation credits. Not directly writable by authenticated users -- use refund_engine_credits() or a service_role path.';
