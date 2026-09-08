-- ============================================================================
-- Hardening & perf — supplements the Paddle/affiliate migrations.
--
--  • Supabase DB indexes tuned for million-row scale (partial/filtered where
--    it matters).
--  • Row Level Security gap closed: profiles gains missing PADDLE-era columns
--    so the generated types and the deployed schema converge; RLS policies on
--    notifications / favorites / products are idempotently restored.
--  • No behaviour change for existing callers — additive-only, idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) High-cardinality indexes (active-path selective, partial where possible)
-- ---------------------------------------------------------------------------

-- Credit hot-path: listAnalyses / listFavorites / notification badge all filter
-- by user_id and sort by created_at DESC — composite index avoids sort.
CREATE INDEX IF NOT EXISTS idx_analysis_history_user_created
  ON public.analysis_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_user_created
  ON public.favorites (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_user_created
  ON public.products (user_id, created_at DESC);

-- Unread badge: the dashboard does notifications.filter(!read) — index it.
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
  ON public.notifications (user_id, read, created_at DESC);

-- Billing hot path: webhook customer-id lookup + tier fallback.
CREATE INDEX IF NOT EXISTS idx_profiles_paddle_customer_id
  ON public.profiles (paddle_customer_id) WHERE paddle_customer_id IS NOT NULL;

-- Credit ledger / admin abuse panel.
CREATE INDEX IF NOT EXISTS idx_credit_usage_log_user_tool
  ON public.credit_usage_log (user_id, tool, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_usage_log_created
  ON public.credit_usage_log (created_at DESC);

-- AI cache expiry sweep (24h TTL) + scope fan-out.
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires_at
  ON public.ai_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_cache_scope_expires
  ON public.ai_cache (scope, expires_at);

-- Rate limit bucket sweep after window expiry.
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_bucket_window
  ON public.api_rate_limits (bucket, window_start);

-- Affiliate join on payout / admin list.
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_created
  ON public.affiliate_commissions (created_at DESC);

-- ---------------------------------------------------------------------------
-- 2) profiles — align deployed schema with generated types + entitlement mirror
--    These columns are written only via SECURITY DEFINER / service_role, so
--    expose them read-only to the owner and keep UPDATE revoked for auth.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status    text       NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS paddle_subscription_id text,
  ADD COLUMN IF NOT EXISTS paddle_customer_id     text,
  ADD COLUMN IF NOT EXISTS paddle_price_id        text,
  ADD COLUMN IF NOT EXISTS current_period_start   timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end     timestamptz,
  ADD COLUMN IF NOT EXISTS next_billed_at         timestamptz;

-- Keep REVOKE additive — if the column was just added there's nothing to
-- revoke yet, but re-running after the Paddle migration must not fail.
DO $$
BEGIN
  BEGIN
    EXECUTE 'REVOKE UPDATE (subscription_status, paddle_subscription_id, paddle_customer_id, paddle_price_id, current_period_start, current_period_end, next_billed_at) ON public.profiles FROM authenticated';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 3) RLS — close the profiles subscription_* read gap for non-admin users
--    and ensure the core user-scoped tables have the expected own-row policies.
--    All DO blocks are idempotent (duplicate_object is swallowed).
-- ---------------------------------------------------------------------------

-- profiles is already RLS-enabled; just make sure the select own-row policy
-- exists even on a freshly restored DB (base migration may not have run in
-- local preview snapshots).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Users view own profile'
  ) THEN
    EXECUTE 'CREATE POLICY \"Users view own profile\" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id)';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- notifications / favorites / products should be RLS + own-row only; restore
-- if a prior migration was skipped in some environments.
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notifications';
  IF FOUND THEN
    EXECUTE 'ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=''public'' AND tablename=''notifications'' AND policyname=''Users manage own notifications'') THEN
      EXECUTE 'CREATE POLICY \"Users manage own notifications\" ON public.notifications FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'favorites';
  IF FOUND THEN
    EXECUTE 'ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=''public'' AND tablename=''favorites'' AND policyname=''Users manage own favorites'') THEN
      EXECUTE 'CREATE POLICY \"Users manage own favorites\" ON public.favorites FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'products';
  IF FOUND THEN
    EXECUTE 'ALTER TABLE public.products ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=''public'' AND tablename=''products'' AND policyname=''Users manage own products'') THEN
      EXECUTE 'CREATE POLICY \"Users manage own products\" ON public.products FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
