-- ============================================================================
-- STAGED -- DO NOT APPLY YET
--
-- Closes the credit self-escalation hole described in docs/PHASE-1-SECURITY.md.
--
-- PREREQUISITE: every client-side write to profiles.credits / sim_credits must
-- first be moved onto public.refund_engine_credits() below. Today the
-- engine-failure refund paths in src/lib/gemini.functions.ts and
-- src/lib/error-helpers.ts update those columns through the user-scoped
-- Supabase client. Applying the REVOKE in section 2 before that refactor lands
-- would silently break credit refunds -- which Phase 1 forbids.
--
-- Promote by moving this file into supabase/migrations/ once the code change
-- is merged, then run `supabase db reset` to verify ordering.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Server-mediated refund path (safe replacement for direct column writes)
--
-- Self-service by design -- a user may only refund their OWN credits -- but
-- bounded so it cannot be turned into a credit faucet:
--   * caller must be authenticated
--   * target row must be the caller's own profile
--   * per-call grant is capped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_engine_credits(
  _search_credits integer DEFAULT 0,
  _sim_credits    integer DEFAULT 0,
  _reason         text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _search integer := LEAST(GREATEST(COALESCE(_search_credits, 0), 0), 5);
  _sim    integer := LEAST(GREATEST(COALESCE(_sim_credits, 0), 0), 5);
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF _search = 0 AND _sim = 0 THEN
    RETURN;
  END IF;

  UPDATE public.profiles
     SET credits     = credits + _search,
         sim_credits = sim_credits + _sim,
         updated_at  = now()
   WHERE id = _caller;

  RAISE LOG '[credits] refunded search=% sim=% to % (reason=%)',
    _search, _sim, _caller, COALESCE(_reason, 'unspecified');
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_engine_credits(integer, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_engine_credits(integer, integer, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Close the hole -- apply ONLY after the refactor described above
--
-- Without this, any authenticated user can mint unlimited paid credits:
--   supabase.from('profiles').update({ credits: 999999 }).eq('id', myId)
-- ---------------------------------------------------------------------------
REVOKE UPDATE (credits, sim_credits) ON public.profiles FROM authenticated;

COMMENT ON COLUMN public.profiles.credits IS
  'Search credits. Not directly writable by authenticated users -- use refund_engine_credits() or a service_role path.';
COMMENT ON COLUMN public.profiles.sim_credits IS
  'Simulation credits. Not directly writable by authenticated users -- use refund_engine_credits() or a service_role path.';
