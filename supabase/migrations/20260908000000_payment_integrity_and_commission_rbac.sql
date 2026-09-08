-- ============================================================================
-- Phase 1 -- Payment integrity + commission RBAC foundation
--
-- Safe to run multiple times (idempotent). Runs after
-- 20260907000000_paddle_production_ready.sql and depends on the subscriptions
-- table and process_paddle_event() defined there.
--
-- NOTHING is dropped or narrowed for existing features. Every change is
-- additive: one new column, two new tables, three new functions, and a
-- CREATE OR REPLACE of process_paddle_event() that preserves the previous
-- behaviour and only adds the out-of-order short-circuit.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Out-of-order guard watermark
--
-- Paddle retries and redelivers webhooks and does not guarantee ordering.
-- Without a watermark a stale lifecycle event can overwrite newer state.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

COMMENT ON COLUMN public.subscriptions.last_event_at IS
  'occurred_at of the newest Paddle lifecycle event applied to this subscription (out-of-order guard)';

-- Backfill so pre-existing rows are not treated as "never seen".
UPDATE public.subscriptions
   SET last_event_at = COALESCE(updated_at, created_at, now())
 WHERE last_event_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_last_event_at
  ON public.subscriptions (paddle_subscription_id, last_event_at DESC);

-- ---------------------------------------------------------------------------
-- 2) affiliates -- who is allowed to earn commission
--
-- A row here is NOT sufficient to earn: status must be 'verified', and only
-- an admin can set that (see set_affiliate_status below).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliates (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending',
  commission_rate numeric(5,4) NOT NULL DEFAULT 0.3000,
  payout_email    text,
  verified_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at     timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliates_status_check
    CHECK (status IN ('pending', 'verified', 'suspended')),
  -- Hard ceiling: even a compromised admin session cannot set a 900% rate.
  CONSTRAINT affiliates_rate_check
    CHECK (commission_rate >= 0 AND commission_rate <= 0.5000)
);

COMMENT ON TABLE public.affiliates IS
  'Micro-influencer commission programme membership. Only status = verified accrues commission.';

CREATE INDEX IF NOT EXISTS idx_affiliates_status ON public.affiliates (status);

-- Read-only for the affiliate themselves; all writes go through service_role
-- or the admin-gated set_affiliate_status() function.
REVOKE ALL ON public.affiliates FROM anon, authenticated;
GRANT SELECT ON public.affiliates TO authenticated;
GRANT ALL ON public.affiliates TO service_role;
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Affiliates view own membership" ON public.affiliates;
CREATE POLICY "Affiliates view own membership" ON public.affiliates
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_affiliates_updated_at ON public.affiliates;
CREATE TRIGGER trg_affiliates_updated_at
  BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3) commission_events -- append-only accrual ledger
--
-- The UNIQUE (paddle_transaction_id, affiliate_user_id) constraint is the
-- idempotency guarantee: a redelivered Paddle transaction cannot pay twice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commission_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paddle_transaction_id  text NOT NULL,
  paddle_subscription_id text,
  gross_amount_cents     integer NOT NULL DEFAULT 0,
  commission_cents       integer NOT NULL DEFAULT 0,
  commission_rate        numeric(5,4) NOT NULL,
  currency               text NOT NULL DEFAULT 'USD',
  status                 text NOT NULL DEFAULT 'accrued',
  occurred_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_events_status_check
    CHECK (status IN ('accrued', 'reversed', 'paid')),
  CONSTRAINT commission_events_amounts_check
    CHECK (gross_amount_cents >= 0 AND commission_cents >= 0),
  CONSTRAINT commission_events_unique
    UNIQUE (paddle_transaction_id, affiliate_user_id)
);

COMMENT ON TABLE public.commission_events IS
  'Append-only recurring-commission ledger. Written only by service_role via accrue_affiliate_commission().';

CREATE INDEX IF NOT EXISTS idx_commission_events_affiliate
  ON public.commission_events (affiliate_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_events_status
  ON public.commission_events (status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_events_subscription
  ON public.commission_events (paddle_subscription_id);

-- No INSERT/UPDATE/DELETE for end users under any circumstance.
REVOKE ALL ON public.commission_events FROM anon, authenticated;
GRANT SELECT ON public.commission_events TO authenticated;
GRANT ALL ON public.commission_events TO service_role;
ALTER TABLE public.commission_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Affiliates view own commission" ON public.commission_events;
CREATE POLICY "Affiliates view own commission" ON public.commission_events
  FOR SELECT TO authenticated USING (auth.uid() = affiliate_user_id);

-- Admin read-all policies, only when the shared has_role() helper exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'has_role' AND n.nspname = 'public'
  ) THEN
    EXECUTE
      'DROP POLICY IF EXISTS "Admins view all affiliates" ON public.affiliates';
    EXECUTE
      'CREATE POLICY "Admins view all affiliates" ON public.affiliates
       FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''))';
    EXECUTE
      'DROP POLICY IF EXISTS "Admins view all commission" ON public.commission_events';
    EXECUTE
      'CREATE POLICY "Admins view all commission" ON public.commission_events
       FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''))';
  ELSE
    RAISE WARNING '[commission] public.has_role() not found -- admin read policies skipped';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) accrue_affiliate_commission() -- service_role only
--
-- Called from the Paddle webhook after a successful payment. Returns a short
-- status string so the caller can log without branching on exceptions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accrue_affiliate_commission(
  _referred_user_id uuid,
  _transaction_id   text,
  _subscription_id  text,
  _amount_cents     bigint,
  _currency         text,
  _occurred_at      timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _affiliate_id uuid;
  _rate         numeric(5,4);
  _status       text;
  _commission   integer;
BEGIN
  IF _referred_user_id IS NULL
     OR _transaction_id IS NULL OR _transaction_id = ''
     OR COALESCE(_amount_cents, 0) <= 0 THEN
    RETURN 'skipped_invalid_input';
  END IF;

  -- Who referred this paying user?
  SELECT p.referred_by INTO _affiliate_id
    FROM public.profiles p
   WHERE p.id = _referred_user_id;

  IF _affiliate_id IS NULL THEN
    RETURN 'skipped_no_referrer';
  END IF;

  -- Self-referral can never pay out.
  IF _affiliate_id = _referred_user_id THEN
    RETURN 'skipped_self_referral';
  END IF;

  -- RBAC gate: the referrer must be an admin-verified affiliate.
  SELECT a.commission_rate, a.status
    INTO _rate, _status
    FROM public.affiliates a
   WHERE a.user_id = _affiliate_id;

  IF _status IS NULL THEN
    RETURN 'skipped_not_affiliate';
  END IF;

  IF _status <> 'verified' THEN
    RETURN 'skipped_not_verified';
  END IF;

  _commission := GREATEST(FLOOR(_amount_cents * COALESCE(_rate, 0))::integer, 0);

  INSERT INTO public.commission_events (
    affiliate_user_id, referred_user_id, paddle_transaction_id,
    paddle_subscription_id, gross_amount_cents, commission_cents,
    commission_rate, currency, status, occurred_at
  ) VALUES (
    _affiliate_id,
    _referred_user_id,
    _transaction_id,
    NULLIF(_subscription_id, ''),
    LEAST(_amount_cents, 2147483647)::integer,
    _commission,
    COALESCE(_rate, 0),
    COALESCE(NULLIF(_currency, ''), 'USD'),
    'accrued',
    COALESCE(_occurred_at, now())
  )
  ON CONFLICT (paddle_transaction_id, affiliate_user_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  RETURN 'accrued';
END;
$function$;

REVOKE ALL ON FUNCTION public.accrue_affiliate_commission(uuid, text, text, bigint, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_affiliate_commission(uuid, text, text, bigint, text, timestamptz)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5) reverse_affiliate_commission() -- refunds / chargebacks, service_role only
--
-- Self-healing counterpart: when Paddle reports a refund or chargeback the
-- accrual is flipped to 'reversed' instead of being deleted, preserving the
-- audit trail.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_affiliate_commission(
  _transaction_id text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _affected integer;
BEGIN
  IF _transaction_id IS NULL OR _transaction_id = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.commission_events
     SET status = 'reversed'
   WHERE paddle_transaction_id = _transaction_id
     AND status <> 'paid';

  GET DIAGNOSTICS _affected = ROW_COUNT;
  RETURN _affected;
END;
$function$;

REVOKE ALL ON FUNCTION public.reverse_affiliate_commission(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_affiliate_commission(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) set_affiliate_status() -- the ONLY authenticated-callable entry point
--
-- Admin-only by construction: the has_role() check lives inside the function,
-- so it holds for every caller including the client SDK.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'has_role' AND n.nspname = 'public'
  ) THEN
    RAISE WARNING '[commission] public.has_role() not found -- set_affiliate_status() not created';
    RETURN;
  END IF;

  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public.set_affiliate_status(
    _user_id uuid,
    _status  text,
    _rate    numeric DEFAULT NULL
  ) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'forbidden: admin role required to manage affiliates'
        USING ERRCODE = '42501';
    END IF;

    IF _status NOT IN ('pending', 'verified', 'suspended') THEN
      RAISE EXCEPTION 'invalid affiliate status: %', _status
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.affiliates (user_id, status, commission_rate, verified_by, verified_at)
    VALUES (
      _user_id,
      _status,
      COALESCE(_rate, 0.3000),
      auth.uid(),
      CASE WHEN _status = 'verified' THEN now() ELSE NULL END
    )
    ON CONFLICT (user_id) DO UPDATE SET
      status          = EXCLUDED.status,
      commission_rate = COALESCE(_rate, public.affiliates.commission_rate),
      verified_by     = auth.uid(),
      verified_at     = CASE WHEN EXCLUDED.status = 'verified'
                             THEN COALESCE(public.affiliates.verified_at, now())
                             ELSE NULL END;
  END;
  $body$;
  $fn$;

  EXECUTE 'REVOKE ALL ON FUNCTION public.set_affiliate_status(uuid, text, numeric) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_affiliate_status(uuid, text, numeric) TO authenticated, service_role';
END $$;

-- ---------------------------------------------------------------------------
-- 7) process_paddle_event() -- CREATE OR REPLACE with out-of-order guard
--
-- Identical to 20260907000000 except for:
--   * _existing_event_at declaration
--   * step 1b staleness short-circuit (money-bearing events never skipped)
--   * last_event_at written on insert and monotonically advanced on conflict
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_paddle_event(
  _event_id                 text,
  _event_type               text,
  _occurred_at              timestamptz,
  _user_id                  uuid,
  _tier                     text,
  _status                   text,
  _paddle_subscription_id   text,
  _paddle_customer_id       text,
  _price_id                 text,
  _currency                 text,
  _amount_cents             bigint,
  _period_start             timestamptz,
  _period_end               timestamptz,
  _next_billed_at           timestamptz,
  _transaction_id           text,
  _cancel_at_period_end     boolean,
  _search_credits           integer,
  _sim_credits              integer,
  _payload                  jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _effective_tier    text;
  _effective_status  text;
  _alt_tier          text;
  _alt_sub_id        text;
  _use_alt           boolean := false;
  _existing_event_at timestamptz;
BEGIN
  -- 1) Idempotency -- dedupe insert and every write below share ONE
  --    transaction, so a rolled-back attempt leaves nothing behind.
  INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at, payload)
  VALUES (_event_id, _event_type, COALESCE(_occurred_at, now()), COALESCE(_payload, '{}'::jsonb))
  ON CONFLICT (event_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  -- 1b) Out-of-order guard.
  --     Paddle does not guarantee ordering. A lifecycle event older than the
  --     newest one already applied must not overwrite fresher state.
  --     Money-bearing events (those carrying a transaction id, and therefore
  --     possibly credits) are NEVER skipped -- dropping one would lose a
  --     payment. They are replay-protected by the dedupe insert above and by
  --     transactions_paddle_external_unique.
  IF _paddle_subscription_id IS NOT NULL AND _paddle_subscription_id <> ''
     AND (_transaction_id IS NULL OR _transaction_id = '')
     AND _occurred_at IS NOT NULL THEN
    SELECT s.last_event_at INTO _existing_event_at
      FROM public.subscriptions s
     WHERE s.paddle_subscription_id = _paddle_subscription_id;

    IF _existing_event_at IS NOT NULL AND _occurred_at < _existing_event_at THEN
      RAISE WARNING '[paddle] stale event % (%) for subscription % -- occurred_at % < watermark %',
        _event_id, _event_type, _paddle_subscription_id, _occurred_at, _existing_event_at;
      RETURN 'stale';
    END IF;
  END IF;

  -- 2) Subscription ledger upsert.
  IF _paddle_subscription_id IS NOT NULL AND _paddle_subscription_id <> '' THEN
    INSERT INTO public.subscriptions AS s (
      user_id, paddle_subscription_id, paddle_customer_id, tier, status, price_id, currency,
      current_period_start, current_period_end, next_billed_at, cancel_at_period_end, canceled_at,
      last_event_at
    ) VALUES (
      _user_id,
      _paddle_subscription_id,
      _paddle_customer_id,
      COALESCE(NULLIF(_tier, ''), 'Pro'),
      COALESCE(NULLIF(_status, ''), 'none'),
      _price_id,
      _currency,
      _period_start,
      _period_end,
      _next_billed_at,
      COALESCE(_cancel_at_period_end, false),
      CASE WHEN _status IN ('canceled', 'past_due', 'paused')
           THEN COALESCE(_occurred_at, now()) ELSE NULL END,
      COALESCE(_occurred_at, now())
    )
    ON CONFLICT (paddle_subscription_id) DO UPDATE SET
      user_id               = EXCLUDED.user_id,
      paddle_customer_id    = COALESCE(EXCLUDED.paddle_customer_id, s.paddle_customer_id),
      tier                  = CASE WHEN EXCLUDED.tier IS NOT NULL THEN EXCLUDED.tier ELSE s.tier END,
      status                = EXCLUDED.status,
      price_id              = COALESCE(EXCLUDED.price_id, s.price_id),
      currency              = COALESCE(EXCLUDED.currency, s.currency),
      current_period_start  = COALESCE(EXCLUDED.current_period_start, s.current_period_start),
      current_period_end    = COALESCE(EXCLUDED.current_period_end, s.current_period_end),
      next_billed_at        = COALESCE(EXCLUDED.next_billed_at, s.next_billed_at),
      cancel_at_period_end  = COALESCE(EXCLUDED.cancel_at_period_end, s.cancel_at_period_end),
      canceled_at           = COALESCE(EXCLUDED.canceled_at, s.canceled_at),
      -- Monotonic watermark: never moves backwards.
      last_event_at         = GREATEST(
                                COALESCE(s.last_event_at, to_timestamp(0)),
                                COALESCE(EXCLUDED.last_event_at, to_timestamp(0))
                              );
  END IF;

  -- 3) Effective tier/status for the profile mirror.
  SELECT tier, status
    INTO _effective_tier, _effective_status
  FROM public.subscriptions
  WHERE paddle_subscription_id = _paddle_subscription_id;

  _effective_tier   := COALESCE(NULLIF(_tier, ''), _effective_tier, 'Pro');
  _effective_status := COALESCE(NULLIF(_status, ''), _effective_status, 'active');

  -- 4) Revoking event (canceled / past_due / paused)? Keep access when the user
  --    still has ANOTHER live subscription (upgrade flows cancel the old one).
  IF _effective_status IN ('canceled', 'past_due', 'paused') THEN
    SELECT s2.tier, s2.paddle_subscription_id
      INTO _alt_tier, _alt_sub_id
    FROM public.subscriptions s2
    WHERE s2.user_id = _user_id
      AND s2.paddle_subscription_id IS DISTINCT FROM _paddle_subscription_id
      AND s2.status IN ('active', 'trialing')
    ORDER BY s2.updated_at DESC
    LIMIT 1;

    IF FOUND THEN
      _use_alt          := true;
      _effective_tier   := _alt_tier;
      _effective_status := 'active';
    ELSE
      _effective_tier := 'Free';
    END IF;
  END IF;

  -- 5) Profile mirror + credit top-up.
  UPDATE public.profiles
  SET subscription_tier      = _effective_tier,
      subscription_status    = _effective_status,
      paddle_subscription_id = CASE
                                 WHEN _use_alt THEN _alt_sub_id
                                 ELSE COALESCE(NULLIF(_paddle_subscription_id, ''), paddle_subscription_id)
                               END,
      paddle_customer_id     = COALESCE(NULLIF(_paddle_customer_id, ''), paddle_customer_id),
      paddle_price_id        = COALESCE(NULLIF(_price_id, ''), paddle_price_id),
      current_period_start   = COALESCE(_period_start, current_period_start),
      current_period_end     = COALESCE(_period_end, current_period_end),
      next_billed_at         = COALESCE(_next_billed_at, next_billed_at),
      credits                = credits + GREATEST(COALESCE(_search_credits, 0), 0),
      sim_credits            = sim_credits + GREATEST(COALESCE(_sim_credits, 0), 0),
      updated_at             = now()
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE WARNING '[paddle] profile row missing for user % (event %)', _user_id, _event_id;
  END IF;

  -- 6) Transaction ledger for actual payments.
  IF _transaction_id IS NOT NULL AND _transaction_id <> '' THEN
    INSERT INTO public.transactions (
      user_id, email, tier, amount_cents, currency, payment_method,
      provider, provider_event, external_id, created_at
    ) VALUES (
      _user_id,
      NULL,
      _effective_tier,
      COALESCE(_amount_cents, 0)::integer,
      COALESCE(NULLIF(_currency, ''), 'USD'),
      'paddle',
      'paddle',
      _event_type,
      _transaction_id,
      COALESCE(_occurred_at, now())
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- 7) Mark promo redemption as purchased (admin reporting) -- first payment only.
  IF _transaction_id IS NOT NULL
     AND _amount_cents IS NOT NULL
     AND _amount_cents > 0 THEN
    UPDATE public.promo_redemptions
    SET purchased_tier = _effective_tier,
        purchased_at   = now(),
        amount_cents   = _amount_cents::integer
    WHERE user_id = _user_id
      AND purchased_at IS NULL;
  END IF;

  RETURN 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.process_paddle_event(
  text, text, timestamptz, uuid, text, text, text, text, text, text,
  bigint, timestamptz, timestamptz, timestamptz, text, boolean, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_paddle_event(
  text, text, timestamptz, uuid, text, text, text, text, text, text,
  bigint, timestamptz, timestamptz, timestamptz, text, boolean, integer, integer, jsonb
) TO service_role;
