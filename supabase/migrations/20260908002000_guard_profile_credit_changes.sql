-- ============================================================================
-- Phase 1c -- Close the credit self-escalation hole WITHOUT breaking refunds
--
-- Idempotent and additive. No grant, policy or column is removed, and no
-- application code has to change for this to be safe.
--
-- Background: profiles.credits / sim_credits are intentionally writable by
-- `authenticated` so the engine-failure refund paths can give a credit back
-- through the user-scoped client. The side effect is that ANY authenticated
-- user can mint credits:
--
--   supabase.from('profiles').update({ credits: 999999 }).eq('id', myId)
--
-- A plain REVOKE closes the hole but breaks refunds. This trigger instead
-- polices the *behaviour*: decreases and server-side grants are untouched,
-- while user-originated increases are bounded, audited and rate-limited.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Internal-write flag
--
-- SECURITY DEFINER functions that legitimately grant credits on behalf of a
-- logged-in user set this for the duration of their transaction so the trigger
-- steps aside (and does not double-count their audit row).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_internal_credit_write()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT set_config('aroless.internal_credit_write', 'on', true);
$function$;

REVOKE ALL ON FUNCTION public.begin_internal_credit_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_internal_credit_write() TO service_role;

-- ---------------------------------------------------------------------------
-- 2) The guard
--
-- Exemptions, in order:
--   a) internal flag set   -> a vetted SECURITY DEFINER grant is in progress
--   b) auth.uid() IS NULL  -> service_role / cron / SQL editor, not an end user
--   c) delta <= 0          -> spending or clearing credits is always allowed
--
-- Anything else is a user-originated increase and gets bounded + audited.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_credit_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _caller       uuid := auth.uid();
  _delta_search integer := COALESCE(NEW.credits, 0)     - COALESCE(OLD.credits, 0);
  _delta_sim    integer := COALESCE(NEW.sim_credits, 0) - COALESCE(OLD.sim_credits, 0);
  _per_call_cap constant integer := 5;
  _daily_cap    constant integer := 20;
  _spent_today  integer;
BEGIN
  -- (a) Vetted internal grant in progress.
  IF COALESCE(current_setting('aroless.internal_credit_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  -- (b) Not an end-user request (service_role, cron, migrations, psql).
  IF _caller IS NULL THEN
    RETURN NEW;
  END IF;

  -- (c) No increase -> nothing to police. Spending must never be blocked.
  IF _delta_search <= 0 AND _delta_sim <= 0 THEN
    RETURN NEW;
  END IF;

  -- A user may only ever grow their OWN balance, and only in small steps.
  IF NEW.id IS DISTINCT FROM _caller THEN
    RAISE EXCEPTION
      'forbidden: cannot increase credits on another profile'
      USING ERRCODE = '42501';
  END IF;

  IF _delta_search > _per_call_cap OR _delta_sim > _per_call_cap THEN
    RAISE EXCEPTION
      'forbidden: credit increase of %/% exceeds the per-operation limit of %',
      _delta_search, _delta_sim, _per_call_cap
      USING ERRCODE = '42501';
  END IF;

  -- Rolling 24h ceiling, shared with refund_engine_credits() so neither path
  -- can be looped to bypass the other.
  SELECT COALESCE(SUM(search_credits + sim_credits), 0)
    INTO _spent_today
    FROM public.credit_refund_events
   WHERE user_id = _caller
     AND created_at >= now() - interval '24 hours';

  IF _spent_today + GREATEST(_delta_search, 0) + GREATEST(_delta_sim, 0) > _daily_cap THEN
    RAISE EXCEPTION
      'forbidden: daily credit refund limit reached (% of %)', _spent_today, _daily_cap
      USING ERRCODE = '42501';
  END IF;

  -- Audit the direct write so it counts against the same ceiling next time.
  INSERT INTO public.credit_refund_events (
    user_id, search_credits, sim_credits, reason
  ) VALUES (
    _caller,
    GREATEST(_delta_search, 0),
    GREATEST(_delta_sim, 0),
    'direct_client_update'
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_profile_credit_changes ON public.profiles;
CREATE TRIGGER trg_guard_profile_credit_changes
  BEFORE UPDATE OF credits, sim_credits ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_credit_changes();

COMMENT ON FUNCTION public.guard_profile_credit_changes() IS
  'Bounds and audits user-originated increases to profiles.credits/sim_credits. Server-side grants and all decreases pass through untouched.';

-- ---------------------------------------------------------------------------
-- 3) refund_engine_credits() -- mark its own UPDATE as internal
--
-- Without this the RPC would write its ledger row and then the trigger would
-- write a second one, halving the effective daily cap.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_engine_credits(
  _search_credits  integer DEFAULT 1,
  _sim_credits     integer DEFAULT 0,
  _reason          text    DEFAULT NULL,
  _idempotency_key text    DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _caller      uuid := auth.uid();
  _search      integer := LEAST(GREATEST(COALESCE(_search_credits, 0), 0), 5);
  _sim         integer := LEAST(GREATEST(COALESCE(_sim_credits, 0), 0), 5);
  _spent_today integer;
  _daily_cap   constant integer := 20;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required' USING ERRCODE = '42501';
  END IF;

  IF _search = 0 AND _sim = 0 THEN
    RETURN 'noop';
  END IF;

  IF _idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_refund_events
     WHERE user_id = _caller AND idempotency_key = _idempotency_key
  ) THEN
    RETURN 'duplicate';
  END IF;

  SELECT COALESCE(SUM(search_credits + sim_credits), 0)
    INTO _spent_today
    FROM public.credit_refund_events
   WHERE user_id = _caller
     AND created_at >= now() - interval '24 hours';

  IF _spent_today + _search + _sim > _daily_cap THEN
    RAISE WARNING '[credits] daily refund cap reached for % (spent=%)', _caller, _spent_today;
    RETURN 'cap_reached';
  END IF;

  INSERT INTO public.credit_refund_events (
    user_id, search_credits, sim_credits, reason, idempotency_key
  ) VALUES (
    _caller, _search, _sim, COALESCE(_reason, 'engine_failure'), _idempotency_key
  )
  ON CONFLICT DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  -- This grant is already audited above; stand the trigger down for it.
  PERFORM set_config('aroless.internal_credit_write', 'on', true);

  UPDATE public.profiles
     SET credits     = credits + _search,
         sim_credits = sim_credits + _sim,
         updated_at  = now()
   WHERE id = _caller;

  PERFORM set_config('aroless.internal_credit_write', 'off', true);

  RETURN 'refunded';
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_engine_credits(integer, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_engine_credits(integer, integer, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verification (run manually on staging as an authenticated user)
--
--   -- 1. the exploit is dead
--   UPDATE public.profiles SET credits = 999999 WHERE id = auth.uid();
--   --> ERROR 42501 credit increase of ... exceeds the per-operation limit of 5
--
--   -- 2. the legitimate refund still works
--   UPDATE public.profiles SET credits = credits + 1 WHERE id = auth.uid();
--   --> UPDATE 1, plus one credit_refund_events row (reason=direct_client_update)
--
--   -- 3. spending is never blocked
--   UPDATE public.profiles SET credits = credits - 1 WHERE id = auth.uid();
--   --> UPDATE 1, no audit row
--
--   -- 4. cross-account escalation is impossible
--   UPDATE public.profiles SET credits = credits + 1 WHERE id <> auth.uid();
--   --> ERROR 42501 (or 0 rows, blocked earlier by RLS)
--
--   -- 5. looping is bounded
--   repeat step 2 twenty-one times --> ERROR 42501 daily credit refund limit reached
--
--   -- 6. server grants are unaffected (service_role session)
--   SELECT public.process_paddle_event(...);  --> credits granted normally
-- ---------------------------------------------------------------------------
