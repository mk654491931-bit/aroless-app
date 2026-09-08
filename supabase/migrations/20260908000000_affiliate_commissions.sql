-- ============================================================================
-- Verified-affiliate recurring commission system (micro-influencer program)
--
-- Adds:
--   1. public.affiliates             — application + admin verification (RBAC)
--   2. public.affiliate_commissions  — recurring 30% commission ledger
--   3. public.verify_affiliate()     — SECURITY DEFINER, admin-only status changes
--   4. process_paddle_event()        — extended ATOMICALLY: on every successful
--                                      subscription payment the verified
--                                      affiliate of the paying user earns a
--                                      recurring commission. Runs inside the
--                                      same transaction as the webhook dedupe,
--                                      so retries can never double-credit.
--
-- Security model:
--   - Only admins (public.has_role) can verify / revoke / change rates.
--   - Authenticated users can read their OWN affiliate row + commissions and
--     may submit an application row (status 'pending') — nothing else.
--   - profiles.referred_by becomes server-writable only (REVOKE from
--     authenticated) so users cannot self-attribute to an affiliate to farm
--     commissions on their own payments.
--   - No INSERT/UPDATE/DELETE policies exist on either table for
--     authenticated — all writes go through service_role or SECURITY DEFINER
--     functions.
--
-- Safe to run multiple times (idempotent). Runs after
-- 20260907000000_paddle_production_ready.sql (requires process_paddle_event).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) affiliates — application + verification state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliates (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'verified', 'revoked')),
  commission_rate_pct integer NOT NULL DEFAULT 30
                      CHECK (commission_rate_pct BETWEEN 0 AND 100),
  verified_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.affiliates IS
  'Affiliate program members. Only rows with status=verified earn commissions.';
COMMENT ON COLUMN public.affiliates.commission_rate_pct IS
  'Recurring commission percent applied to each successful subscription payment (default 30).';

GRANT SELECT ON public.affiliates TO authenticated;
GRANT ALL ON public.affiliates TO service_role;
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;

-- Users see only their own application/status.
DROP POLICY IF EXISTS "Users view own affiliate row" ON public.affiliates;
CREATE POLICY "Users view own affiliate row" ON public.affiliates
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Admins see every affiliate (shared has_role helper from the base schema).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'has_role' AND n.nspname = 'public'
  ) THEN
    EXECUTE
      'CREATE POLICY "Admins view all affiliates" ON public.affiliates
       FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''))';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_affiliates_updated_at ON public.affiliates;
CREATE TRIGGER trg_affiliates_updated_at
  BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2) affiliate_commissions — immutable recurring commission ledger
--    One row per paid transaction; transaction_id is unique so the same
--    payment can never be commissioned twice, even across retried webhooks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_commissions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subscription_id      text,
  tier                 text,
  gross_amount_cents   integer NOT NULL DEFAULT 0,
  commission_rate_pct  integer NOT NULL DEFAULT 30,
  commission_cents     integer NOT NULL DEFAULT 0,
  transaction_id       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_commissions_transaction_unique UNIQUE (transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate
  ON public.affiliate_commissions (affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_referred
  ON public.affiliate_commissions (referred_user_id);

COMMENT ON TABLE public.affiliate_commissions IS
  'Recurring commissions earned by verified affiliates (30% of gross by default).';

GRANT SELECT ON public.affiliate_commissions TO authenticated;
GRANT ALL ON public.affiliate_commissions TO service_role;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;

-- Affiliates see their own commissions.
DROP POLICY IF EXISTS "Users view own commissions" ON public.affiliate_commissions;
CREATE POLICY "Users view own commissions" ON public.affiliate_commissions
  FOR SELECT TO authenticated USING (auth.uid() = affiliate_id);

-- Admins see every commission line (payout reconciliation).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'has_role' AND n.nspname = 'public'
  ) THEN
    EXECUTE
      'CREATE POLICY "Admins view all commissions" ON public.affiliate_commissions
       FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''))';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Lock profiles.referred_by to server-side writes.
--    Users can otherwise self-attribute to a verified affiliate and generate
--    commissions on their own payments. Only claimReferral (service_role) and
--    process_paddle_event (SECURITY DEFINER) may write this column.
-- ---------------------------------------------------------------------------
REVOKE UPDATE (referred_by) ON public.profiles FROM authenticated;

-- Lookup index for the commission join (profiles.referred_by → affiliates).
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by
  ON public.profiles (referred_by)
  WHERE referred_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) public.verify_affiliate() — the ONLY status/rate transition path.
--    SECURITY DEFINER: checks admin role INSIDE the function; authenticated
--    callers can never pass a forged _admin_id because the check runs with
--    the function owner's privileges against the caller-supplied admin id.
--    Practically it is invoked by service_role server functions only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_affiliate(
  _admin_id   uuid,
  _user_id    uuid,
  _status     text,
  _rate_pct   integer
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _valid_status text := lower(btrim(COALESCE(_status, '')));
BEGIN
  -- RBAC gate: only an actual admin can change affiliate state.
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _valid_status NOT IN ('pending', 'verified', 'revoked') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  UPDATE public.affiliates
  SET status             = _valid_status,
      commission_rate_pct = GREATEST(0, LEAST(100, COALESCE(_rate_pct, commission_rate_pct))),
      verified_by        = CASE WHEN _valid_status = 'verified' THEN _admin_id ELSE verified_by END,
      verified_at        = CASE WHEN _valid_status = 'verified' THEN now() ELSE verified_at END,
      updated_at         = now()
  WHERE user_id = _user_id;

  IF NOT FOUND THEN
    INSERT INTO public.affiliates (
      user_id, status, commission_rate_pct, verified_by, verified_at
    ) VALUES (
      _user_id,
      _valid_status,
      GREATEST(0, LEAST(100, COALESCE(_rate_pct, 30))),
      CASE WHEN _valid_status = 'verified' THEN _admin_id ELSE NULL END,
      CASE WHEN _valid_status = 'verified' THEN now() ELSE NULL END
    );
  END IF;

  RETURN 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_affiliate(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_affiliate(uuid, uuid, text, integer)
  TO service_role;

COMMENT ON FUNCTION public.verify_affiliate(uuid, uuid, text, integer) IS
  'Admin-only affiliate verification/revocation (RBAC checked inside the function).';

-- ---------------------------------------------------------------------------
-- 5) process_paddle_event() — extended with the recurring commission step.
--    Everything else is byte-identical to the previous migration; step 8 is
--    additive and runs INSIDE the same transaction as the idempotency dedupe:
--      - a replayed webhook returns 'duplicate' before reaching this block
--      - a rolled-back attempt leaves no commission behind
--      - the UNIQUE (transaction_id) constraint is a second net: the same
--        payment can never be commissioned twice even under a different event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_paddle_event(
  _event_id                 text,
  _event_type               text,
  _occurred_at              timestamptz,
  _user_id                  uuid,
  _tier                     text,          -- 'Starter'|'Pro'|'Business'|'Free' | NULL = preserve
  _status                   text,          -- active|trialing|canceled|past_due|paused
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
  _effective_tier   text;
  _effective_status text;
  _alt_tier         text;
  _alt_sub_id       text;
  _use_alt          boolean := false;
BEGIN
  -- 1) Idempotency — the dedupe insert and every write below are in ONE
  --    transaction, so a rolled-back attempt leaves nothing behind.
  INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at, payload)
  VALUES (_event_id, _event_type, COALESCE(_occurred_at, now()), COALESCE(_payload, '{}'::jsonb))
  ON CONFLICT (event_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  -- 2) Subscription ledger upsert.
  IF _paddle_subscription_id IS NOT NULL AND _paddle_subscription_id <> '' THEN
    INSERT INTO public.subscriptions AS s (
      user_id, paddle_subscription_id, paddle_customer_id, tier, status, price_id, currency,
      current_period_start, current_period_end, next_billed_at, cancel_at_period_end, canceled_at
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
           THEN COALESCE(_occurred_at, now()) ELSE NULL END
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
      canceled_at           = COALESCE(EXCLUDED.canceled_at, s.canceled_at);
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

  -- 7) Mark promo redemption as purchased (admin reporting) — first payment only.
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

  -- 8) Affiliate recurring commission — verified affiliates only.
  --     Same-transaction + UNIQUE(transaction_id) = idempotent by construction.
  IF _transaction_id IS NOT NULL AND _transaction_id <> ''
     AND _amount_cents IS NOT NULL AND _amount_cents >= 100 THEN
    INSERT INTO public.affiliate_commissions (
      affiliate_id, referred_user_id, subscription_id, tier,
      gross_amount_cents, commission_rate_pct, commission_cents, transaction_id
    )
    SELECT a.user_id, _user_id, _paddle_subscription_id, _effective_tier,
           _amount_cents::integer, a.commission_rate_pct,
           GREATEST(1, round(_amount_cents * a.commission_rate_pct / 100.0))::integer,
           _transaction_id
    FROM public.affiliates a
    JOIN public.profiles p ON p.referred_by = a.user_id
    WHERE p.id = _user_id
      AND a.status = 'verified'
      AND a.commission_rate_pct > 0
    ON CONFLICT (transaction_id) DO NOTHING;
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