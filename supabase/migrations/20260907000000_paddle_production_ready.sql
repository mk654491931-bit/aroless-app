-- ============================================================================
-- Paddle Billing v2 — production-ready hardening
-- Adds: profiles entitlement columns, subscriptions ledger, processed webhook
-- events (idempotency), and the atomic public.process_paddle_event() processor.
--
-- Safe to run multiple times (idempotent). Designed to run after
-- 20260901000000_paddle_migration.sql, but does not depend on it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) profiles — denormalized entitlement mirror (the app reads these)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status  TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS paddle_customer_id   TEXT,
  ADD COLUMN IF NOT EXISTS paddle_price_id      TEXT,
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_billed_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_paddle_subscription ON public.profiles (paddle_subscription_id);
CREATE INDEX IF NOT EXISTS idx_profiles_paddle_customer ON public.profiles (paddle_customer_id);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_status ON public.profiles (subscription_status);

COMMENT ON COLUMN public.profiles.subscription_status IS 'Paddle subscription status: none|trialing|active|canceled|past_due|paused';
COMMENT ON COLUMN public.profiles.current_period_start IS 'Start of the current billing period (Paddle)';
COMMENT ON COLUMN public.profiles.current_period_end IS 'End of the current billing period (Paddle)';

-- SECURITY: the base schema grants authenticated users table-wide UPDATE on
-- profiles (needed for language/currency etc.). Revoke column-level UPDATE on
-- the paid-entitlement columns so users can never self-escalate their tier or
-- forge subscription state through the client SDK. Only service_role (and the
-- SECURITY DEFINER process_paddle_event) can write these columns.
-- NOTE: credits/sim_credits are intentionally left updatable — the product's
-- engine-failure refund paths (gemini.functions, error-helpers) update them
-- through the user-scoped client.
REVOKE UPDATE (
  subscription_tier, subscription_status,
  paddle_subscription_id, paddle_customer_id, paddle_price_id,
  current_period_start, current_period_end, next_billed_at
) ON public.profiles FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2) subscriptions — ledger, one row per Paddle subscription
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paddle_subscription_id    text NOT NULL,
  paddle_customer_id        text,
  tier                      text NOT NULL DEFAULT 'Pro',
  status                    text NOT NULL DEFAULT 'none',
  price_id                  text,
  currency                  text,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  next_billed_at            timestamptz,
  cancel_at_period_end      boolean NOT NULL DEFAULT false,
  canceled_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_paddle_subscription_key UNIQUE (paddle_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON public.subscriptions (user_id, status);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own subscriptions" ON public.subscriptions;
CREATE POLICY "Users view own subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Admin read-all policy — only when the shared has_role() helper exists
-- (defined by an earlier migration in the chain).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'has_role' AND n.nspname = 'public'
  ) THEN
    EXECUTE
      'CREATE POLICY "Admins view all subscriptions" ON public.subscriptions
       FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''))';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Keep updated_at fresh (function defined in the base schema migration).
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3) processed_webhook_events — idempotency / replay protection
--    Only the service role can touch this table; RLS is on with no policies
--    for anon/authenticated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  event_id      text PRIMARY KEY,
  event_type    text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_type ON public.processed_webhook_events (event_type, processed_at);

REVOKE ALL ON public.processed_webhook_events FROM anon, authenticated;
GRANT ALL ON public.processed_webhook_events TO service_role;
ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.processed_webhook_events IS 'Paddle webhook event ids already processed (idempotency guard)';

-- ---------------------------------------------------------------------------
-- 4) Transactions dedupe guard for Paddle payments
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS transactions_paddle_external_unique
  ON public.transactions (external_id)
  WHERE provider = 'paddle' AND external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5) public.process_paddle_event() — ATOMIC processor
--
-- Single Postgres transaction that: dedupes the event, upserts the subscription
-- ledger, updates the profile mirror (+ credits), records the payment and marks
-- promo redemptions as purchased. Either everything commits or nothing does, so
-- Paddle retries after a failure can never double-grant credits.
--
-- EXECUTE granted ONLY to service_role — authenticated users must never call it.
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

COMMENT ON FUNCTION public.process_paddle_event(
  text, text, timestamptz, uuid, text, text, text, text, text, text,
  bigint, timestamptz, timestamptz, timestamptz, text, boolean, integer, integer, jsonb
) IS 'Atomic Paddle webhook processor (dedupe + subscription + profile + credits + transaction)';

-- ---------------------------------------------------------------------------
-- 6) Legacy apply_subscription_credits() — same signature, Paddle-safe body.
--    Kept for compatibility with any older callers; new code uses
--    process_paddle_event(). Credits: Starter +10/+5, Pro +20/+10, else passed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_subscription_credits(
  _user_id uuid, _tier text, _credits integer, _customer_id text, _subscription_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  search_credits integer;
  sim_add        integer;
BEGIN
  IF lower(_tier) = 'pro' THEN
    search_credits := 20; sim_add := 10;
  ELSIF lower(_tier) = 'starter' THEN
    search_credits := 10; sim_add := 5;
  ELSE
    search_credits := GREATEST(COALESCE(_credits, 0), 0);
    sim_add        := GREATEST(1, search_credits / 2);
  END IF;

  UPDATE public.profiles
  SET subscription_tier    = COALESCE(NULLIF(_tier, ''), subscription_tier),
      subscription_status  = CASE WHEN lower(_tier) = 'free' THEN 'canceled'
                                  ELSE COALESCE(subscription_status, 'active') END,
      credits              = credits + search_credits,
      sim_credits          = sim_credits + sim_add,
      paddle_customer_id   = COALESCE(NULLIF(_customer_id, ''), paddle_customer_id),
      paddle_subscription_id = COALESCE(NULLIF(_subscription_id, ''), paddle_subscription_id),
      updated_at           = now()
  WHERE id = _user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_subscription_credits(uuid, text, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_credits(uuid, text, integer, text, text)
  TO service_role;
