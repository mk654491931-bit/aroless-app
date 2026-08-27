-- Keep the two free welcome credits scoped to Product Finder only.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS finder_credits integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, credits, finder_credits, sim_credits, subscription_tier)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN public.is_designated_admin(NEW.email) THEN 250 ELSE 0 END,
    CASE WHEN public.is_designated_admin(NEW.email) THEN 0 ELSE 2 END,
    CASE WHEN public.is_designated_admin(NEW.email) THEN 100 ELSE 1 END,
    'Free'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_admin_daily_credits()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles p
  SET credits = 250, credits_reset_at = current_date, updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role = 'admin'
  )
  AND (p.credits_reset_at IS NULL OR p.credits_reset_at < current_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_product_finder_credit()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE remaining integer;
BEGIN
  PERFORM public.refresh_admin_daily_credits();

  UPDATE public.profiles
  SET finder_credits = finder_credits - 1, credits_spent = credits_spent + 1
  WHERE id = auth.uid() AND finder_credits > 0
  RETURNING finder_credits INTO remaining;
  IF remaining IS NOT NULL THEN RETURN remaining; END IF;

  UPDATE public.profiles
  SET credits = credits - 1, credits_spent = credits_spent + 1
  WHERE id = auth.uid() AND credits > 0
  RETURNING credits INTO remaining;
  IF remaining IS NULL THEN RAISE EXCEPTION 'no_credits'; END IF;
  RETURN remaining;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_admin_daily_credits() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deduct_product_finder_credit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_product_finder_credit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_admin_daily_credits() TO service_role;

-- Make the designated account an admin even when it pre-dates the trigger.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM public.profiles
WHERE lower(btrim(coalesce(email, ''))) = 'mk654491931@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

SELECT public.refresh_admin_daily_credits();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'refresh-admin-daily-credits',
      '5 0 * * *',
      'SELECT public.refresh_admin_daily_credits()'
    );
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;