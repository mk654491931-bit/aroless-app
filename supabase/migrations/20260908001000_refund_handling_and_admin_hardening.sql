-- ============================================================================
-- Phase 1b -- Self-healing refunds, bounded credit refunds, admin hardening
--
-- Idempotent. Additive only: no table, column, policy or grant is removed.
-- Depends on 20260908000000_payment_integrity_and_commission_rbac.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) credit_refund_events -- audit trail + idempotency for engine refunds
--
-- Without this the refund path is an unbounded credit faucet: capping a single
-- call is meaningless when the call can be made in a loop.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_refund_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  search_credits  integer NOT NULL DEFAULT 0,
  sim_credits     integer NOT NULL DEFAULT 0,
  reason          text,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_refund_events_amounts_check
    CHECK (search_credits >= 0 AND sim_credits >= 0)
);

COMMENT ON TABLE public.credit_refund_events IS
  'Audit + idempotency ledger for engine-failure credit refunds. Written only by refund_engine_credits().';

-- Idempotency is per user, and only when a key is supplied.
CREATE UNIQUE INDEX IF NOT EXISTS credit_refund_events_idem_unique
  ON public.credit_refund_events (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Supports the daily-cap window scan.
CREATE INDEX IF NOT EXISTS idx_credit_refund_events_user_day
  ON public.credit_refund_events (user_id, created_at DESC);

REVOKE ALL ON public.credit_refund_events FROM anon, authenticated;
GRANT SELECT ON public.credit_refund_events TO authenticated;
GRANT ALL ON public.credit_refund_events TO service_role;
ALTER TABLE public.credit_refund_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own credit refunds" ON public.credit_refund_events;
CREATE POLICY "Users view own credit refunds" ON public.credit_refund_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2) refund_engine_credits() -- bounded, idempotent, audited
--
-- Replaces direct client writes to profiles.credits / sim_credits. Self-service
-- by design (a user may only refund their OWN credits) but not a faucet:
--   * caller must be authenticated; the target row is always auth.uid()
--   * per-call ceiling
--   * per-user daily ceiling
--   * optional idempotency key makes a retried handler a no-op
--
-- Deployed BEFORE the REVOKE in supabase/pending-migrations/, so the refund
-- path is never broken in between.
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
  _caller     uuid := auth.uid();
  _search     integer := LEAST(GREATEST(COALESCE(_search_credits, 0), 0), 5);
  _sim        integer := LEAST(GREATEST(COALESCE(_sim_credits, 0), 0), 5);
  _spent_today integer;
  _daily_cap  constant integer := 20;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required' USING ERRCODE = '42501';
  END IF;

  IF _search = 0 AND _sim = 0 THEN
    RETURN 'noop';
  END IF;

  -- Idempotency: same key, same user -> already paid back.
  IF _idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_refund_events
     WHERE user_id = _caller AND idempotency_key = _idempotency_key
  ) THEN
    RETURN 'duplicate';
  END IF;

  -- Daily cap across both credit kinds.
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

  UPDATE public.profiles
     SET credits     = credits + _search,
         sim_credits = sim_credits + _sim,
         updated_at  = now()
   WHERE id = _caller;

  RETURN 'refunded';
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_engine_credits(integer, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_engine_credits(integer, integer, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) process_paddle_refund() -- atomic, idempotent refund/chargeback handling
--
-- Shares processed_webhook_events with process_paddle_event(), so a redelivered
-- adjustment is a cheap no-op. Everything below commits or rolls back together.
--
-- Deliberately does NOT change subscription_tier: Paddle emits
-- subscription.canceled separately, and downgrading here would cut off a
-- customer who was refunded for one invoice but is still subscribed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_paddle_refund(
  _event_id        text,
  _event_type      text,
  _occurred_at     timestamptz,
  _user_id         uuid,
  _transaction_id  text,
  _subscription_id text,
  _action          text,
  _status          text,
  _amount_cents    bigint,
  _currency        text,
  _full_reversal   boolean,
  _payload         jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _tier             text;
  _search_clawback  integer := 0;
  _sim_clawback     integer := 0;
  _reversed         integer := 0;
BEGIN
  -- 1) Idempotency, shared with the main processor.
  INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at, payload)
  VALUES (_event_id, _event_type, COALESCE(_occurred_at, now()), COALESCE(_payload, '{}'::jsonb))
  ON CONFLICT (event_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  -- Audit-only events (payment_failed, rejected/pending adjustments, credits)
  -- stop here: recorded, no entitlement or money effect.
  IF COALESCE(_full_reversal, false) IS FALSE
     AND _action NOT IN ('refund', 'chargeback') THEN
    RETURN 'recorded';
  END IF;

  -- 2) Reverse affiliate commission for this transaction (audit-preserving).
  IF _transaction_id IS NOT NULL AND _transaction_id <> '' THEN
    UPDATE public.commission_events
       SET status = 'reversed'
     WHERE paddle_transaction_id = _transaction_id
       AND status <> 'paid';
    GET DIAGNOSTICS _reversed = ROW_COUNT;
  END IF;

  -- 3) Credit clawback -- ONLY on a full reversal. A partial refund means the
  --    customer kept part of the delivered value, so their credits stand.
  IF COALESCE(_full_reversal, false) AND _user_id IS NOT NULL THEN
    SELECT t.tier INTO _tier
      FROM public.transactions t
     WHERE t.external_id = _transaction_id
       AND t.provider = 'paddle'
     ORDER BY t.created_at DESC
     LIMIT 1;

    -- Mirrors SUBSCRIPTION_CREDIT_GRANTS in src/lib/paddle.server.ts.
    _search_clawback := CASE lower(COALESCE(_tier, ''))
                          WHEN 'starter'  THEN 10
                          WHEN 'pro'      THEN 20
                          WHEN 'business' THEN 50
                          ELSE 0 END;
    _sim_clawback    := CASE lower(COALESCE(_tier, ''))
                          WHEN 'starter'  THEN 5
                          WHEN 'pro'      THEN 10
                          WHEN 'business' THEN 25
                          ELSE 0 END;

    IF _search_clawback > 0 OR _sim_clawback > 0 THEN
      -- GREATEST(..., 0): never drive a balance negative if the user already
      -- spent the credits. We reclaim what is left, not more.
      UPDATE public.profiles
         SET credits     = GREATEST(credits - _search_clawback, 0),
             sim_credits = GREATEST(sim_credits - _sim_clawback, 0),
             updated_at  = now()
       WHERE id = _user_id;
    END IF;
  END IF;

  -- 4) Negative ledger row. The ":refund:" suffix keeps the existing partial
  --    unique index on external_id from colliding with the original payment.
  IF _transaction_id IS NOT NULL AND _transaction_id <> '' THEN
    INSERT INTO public.transactions (
      user_id, email, tier, amount_cents, currency, payment_method,
      provider, provider_event, external_id, created_at
    ) VALUES (
      _user_id,
      NULL,
      COALESCE(_tier, 'Free'),
      -1 * LEAST(COALESCE(_amount_cents, 0), 2147483647)::integer,
      COALESCE(NULLIF(_currency, ''), 'USD'),
      'paddle',
      'paddle',
      _event_type,
      _transaction_id || ':refund:' || _event_id,
      COALESCE(_occurred_at, now())
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RAISE LOG '[paddle] refund % (%) txn=% clawback=%/% commission_reversed=%',
    _event_id, _action, _transaction_id, _search_clawback, _sim_clawback, _reversed;

  RETURN 'reversed';
END;
$function$;

REVOKE ALL ON FUNCTION public.process_paddle_refund(
  text, text, timestamptz, uuid, text, text, text, text, bigint, text, boolean, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_paddle_refund(
  text, text, timestamptz, uuid, text, text, text, text, bigint, text, boolean, jsonb
) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) is_designated_admin() -- remove the NULL-semantics landmine
--
-- The previous body used COUNT(*) with GROUP BY 1 for the @aroless.com branch.
-- With no matching rows the aggregate is NULL, so "RETURN NULL <= 2" evaluated
-- to NULL and the caller treated it as false -- correct by accident only.
--
-- The hard-coded allowlist is preserved exactly. Also promoted to
-- SECURITY DEFINER: it reads public.profiles, which is RLS-protected, so under
-- the caller's context the count could silently be wrong.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_designated_admin(_email text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _normalized text := lower(trim(COALESCE(_email, '')));
  _existing   integer;
BEGIN
  IF _normalized = '' THEN
    RETURN false;
  END IF;

  -- Explicit allowlist (unchanged).
  IF _normalized IN (
    'mryetenek@gmail.com',
    'mk654491931@gmail.com',
    'omnic.111111@gmail.com',
    'mk65449199@gmail.com'
  ) THEN
    RETURN true;
  END IF;

  -- Company domain: the first two accounts only.
  IF _normalized LIKE '%@aroless.com' THEN
    SELECT COALESCE(COUNT(*), 0)
      INTO _existing
      FROM public.profiles p
     WHERE lower(p.email) LIKE '%@aroless.com'
       AND lower(p.email) <> _normalized;

    RETURN COALESCE(_existing, 0) < 2;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_designated_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_designated_admin(text) TO authenticated, service_role;
