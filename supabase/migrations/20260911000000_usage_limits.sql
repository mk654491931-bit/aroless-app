-- ============================================================================
-- Monthly usage quotas per feature
--
-- One counter row per (user, feature, month). Limits are server-authoritative:
--   Starter   : 8 product finder · 30 AI tools · 2 council · 6 radar
--   Pro       : 15 / 90 / 6 / 20
--   Business  : 50 / 300 / 20 / 60
--   Admin     : 250 per feature (resettable from the admin panel)
--   Academy & Simulation: free and unlimited for every user, never counted.
--
-- Kept in sync with src/lib/plans.ts (single source of truth for the numbers).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.usage_counters (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature      text        NOT NULL,
  period_start date        NOT NULL DEFAULT (date_trunc('month', now())::date),
  used         integer     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature, period_start)
);

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage_counters_select_own" ON public.usage_counters;
CREATE POLICY "usage_counters_select_own" ON public.usage_counters
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS usage_counters_period_idx
  ON public.usage_counters (period_start);

-- Academy and simulation are free forever and never consume quota.
CREATE OR REPLACE FUNCTION public.usage_feature_is_free(_feature text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT _feature IN ('academy', 'simulation');
$$;

CREATE OR REPLACE FUNCTION public.usage_feature_limit(
  _tier text,
  _is_admin boolean,
  _feature text
)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.usage_feature_is_free(_feature) THEN -1
    WHEN _is_admin THEN 250
    ELSE CASE lower(coalesce(_tier, 'free'))
      WHEN 'starter' THEN CASE _feature
        WHEN 'product_finder' THEN 8
        WHEN 'ai_tools' THEN 30
        WHEN 'council' THEN 2
        WHEN 'trend_radar' THEN 6
        ELSE 0 END
      WHEN 'pro' THEN CASE _feature
        WHEN 'product_finder' THEN 15
        WHEN 'ai_tools' THEN 90
        WHEN 'council' THEN 6
        WHEN 'trend_radar' THEN 20
        ELSE 0 END
      WHEN 'business' THEN CASE _feature
        WHEN 'product_finder' THEN 50
        WHEN 'ai_tools' THEN 300
        WHEN 'council' THEN 20
        WHEN 'trend_radar' THEN 60
        ELSE 0 END
      WHEN 'enterprise' THEN CASE _feature
        WHEN 'product_finder' THEN 50
        WHEN 'ai_tools' THEN 300
        WHEN 'council' THEN 20
        WHEN 'trend_radar' THEN 60
        ELSE 0 END
      ELSE CASE _feature
        WHEN 'product_finder' THEN 1
        WHEN 'ai_tools' THEN 3
        WHEN 'council' THEN 0
        WHEN 'trend_radar' THEN 1
        ELSE 0 END
    END
  END;
$$;

-- Resolves the caller's tier and admin flag once per call.
CREATE OR REPLACE FUNCTION public.usage_context(_user_id uuid)
RETURNS TABLE (tier text, is_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    coalesce((SELECT p.subscription_tier FROM public.profiles p WHERE p.id = _user_id), 'Free'),
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.role = 'admin');
$$;

-- Current-month snapshot for the signed-in user (drives the dashboard panel).
CREATE OR REPLACE FUNCTION public.usage_snapshot()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ctx record;
  period date := date_trunc('month', now())::date;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO ctx FROM public.usage_context(uid);

  RETURN jsonb_build_object(
    'tier', ctx.tier,
    'is_admin', ctx.is_admin,
    'period_start', period,
    'period_end', (period + interval '1 month')::date,
    'features', (
      SELECT jsonb_object_agg(
        f.feature,
        jsonb_build_object(
          'used', coalesce(c.used, 0),
          'limit', public.usage_feature_limit(ctx.tier, ctx.is_admin, f.feature),
          'unlimited', public.usage_feature_is_free(f.feature)
        )
      )
      FROM (VALUES
        ('product_finder'), ('ai_tools'), ('council'), ('trend_radar'),
        ('academy'), ('simulation')
      ) AS f(feature)
      LEFT JOIN public.usage_counters c
        ON c.user_id = uid AND c.period_start = period AND c.feature = f.feature
    )
  );
END;
$$;

-- Atomic consume: enforces the monthly limit and increments in one statement.
CREATE OR REPLACE FUNCTION public.consume_usage(_feature text, _amount integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ctx record;
  period date := date_trunc('month', now())::date;
  lim integer;
  new_used integer;
  current_used integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _amount IS NULL OR _amount < 1 THEN _amount := 1; END IF;

  IF public.usage_feature_is_free(_feature) THEN
    RETURN jsonb_build_object('ok', true, 'unlimited', true, 'used', 0, 'limit', -1);
  END IF;

  SELECT * INTO ctx FROM public.usage_context(uid);
  lim := public.usage_feature_limit(ctx.tier, ctx.is_admin, _feature);

  IF lim >= 0 AND _amount > lim THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'limit_reached', 'used', 0, 'limit', lim, 'remaining', 0
    );
  END IF;

  INSERT INTO public.usage_counters (user_id, feature, period_start, used, updated_at)
  VALUES (uid, _feature, period, _amount, now())
  ON CONFLICT (user_id, feature, period_start) DO UPDATE
    SET used = public.usage_counters.used + _amount,
        updated_at = now()
    WHERE lim < 0 OR public.usage_counters.used + _amount <= lim
  RETURNING used INTO new_used;

  IF new_used IS NULL THEN
    SELECT coalesce(c.used, 0) INTO current_used
    FROM public.usage_counters c
    WHERE c.user_id = uid AND c.feature = _feature AND c.period_start = period;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'limit_reached',
      'used', coalesce(current_used, 0),
      'limit', lim,
      'remaining', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'used', new_used,
    'limit', lim,
    'remaining', CASE WHEN lim < 0 THEN -1 ELSE greatest(0, lim - new_used) END,
    'unlimited', lim < 0
  );
END;
$$;

-- Counter bump without enforcement: used by the legacy per-feature deduction
-- paths so the dashboard stays truthful without double-blocking the user.
CREATE OR REPLACE FUNCTION public.record_usage(_feature text, _amount integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  IF public.usage_feature_is_free(_feature) THEN RETURN; END IF;
  IF _amount IS NULL OR _amount < 1 THEN _amount := 1; END IF;

  INSERT INTO public.usage_counters (user_id, feature, period_start, used, updated_at)
  VALUES (uid, _feature, date_trunc('month', now())::date, _amount, now())
  ON CONFLICT (user_id, feature, period_start) DO UPDATE
    SET used = public.usage_counters.used + _amount,
        updated_at = now();
END;
$$;

-- Admin panel reset (service_role only): zeroes this month's counters.
CREATE OR REPLACE FUNCTION public.admin_reset_usage(_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.usage_counters
  WHERE user_id = _user_id AND period_start = date_trunc('month', now())::date;
END;
$$;

REVOKE ALL ON FUNCTION public.usage_snapshot() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_usage(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_usage(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reset_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usage_context(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.usage_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_usage(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_usage(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_usage(uuid) TO service_role;
