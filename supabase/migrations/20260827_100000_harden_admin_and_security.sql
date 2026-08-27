-- Harden admin access, add user ID numbers, and strengthen RLS policies
-- This migration implements the security hardening plan

-- 1. Add user ID number column to profiles (8-digit random)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id_number TEXT UNIQUE;

-- 2. Migrate existing profiles to have user ID numbers
UPDATE public.profiles
SET user_id_number = LPAD(((abs(hashtext(id::text))::bigint % 90000000) + 10000000)::text, 8, '0')
WHERE user_id_number IS NULL;

-- Make user_id_number non-nullable after population
ALTER TABLE public.profiles ALTER COLUMN user_id_number SET NOT NULL;
CREATE UNIQUE INDEX idx_user_id_number ON public.profiles (user_id_number);

-- 3. Create function to check if user is designated admin (fixed list + @aroless.com limit)
CREATE OR REPLACE FUNCTION public.is_designated_admin(_email text)
RETURNS boolean LANGUAGE plpgsql STABLE
AS $$
DECLARE
  normalized_email text;
  aroless_count integer;
BEGIN
  -- Normalize email: lowercase and trim
  normalized_email := lower(btrim(coalesce(_email, '')));
  
  -- Check fixed admin list
  IF normalized_email IN (
    'mryetenek@gmail.com',
    'mk654491931@gmail.com',
    'omnic.111111@gmail.com',
    'mk65449199@gmail.com'
  ) THEN
    RETURN true;
  END IF;
  
  -- Check @aroless.com domain - only first 2 are admin
  IF normalized_email LIKE '%@aroless.com' THEN
    SELECT COUNT(*) INTO aroless_count
    FROM public.profiles p
    WHERE lower(btrim(coalesce(p.email, ''))) LIKE '%@aroless.com'
      AND p.created_at <= (
        SELECT created_at FROM public.profiles
        WHERE lower(btrim(coalesce(email, ''))) = normalized_email
      )
    GROUP BY 1;
    
    RETURN aroless_count <= 2;
  END IF;
  
  RETURN false;
END;
$$;

-- 4. Replace the admin grant trigger with stricter version
DROP TRIGGER IF EXISTS on_auth_user_created_grant_admin ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_confirmed_grant_admin ON auth.users;

CREATE OR REPLACE FUNCTION public.grant_admin_for_designated_email_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only grant admin if email matches designated list
  IF public.is_designated_admin(NEW.email) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.profiles SET credits = GREATEST(credits, 250) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created_grant_admin_v2
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_admin_for_designated_email_v2();

CREATE TRIGGER on_auth_user_confirmed_grant_admin_v2
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW WHEN (old.email_confirmed_at IS NULL AND new.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.grant_admin_for_designated_email_v2();

-- 5. Clean up any admin users not in the designated list
DELETE FROM public.user_roles ur
WHERE ur.role = 'admin'
  AND NOT public.is_designated_admin(
    (SELECT lower(btrim(coalesce(email, '')))
     FROM auth.users au WHERE au.id = ur.user_id)
  );

-- 6. Strengthen RLS on tables that were missing policies
-- ai_cache: only service_role can access
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only" ON public.ai_cache;
CREATE POLICY "Service role only" ON public.ai_cache
  FOR ALL USING (false);

-- email_otps: only service_role can access
ALTER TABLE public.email_otps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only" ON public.email_otps;
CREATE POLICY "Service role only" ON public.email_otps
  FOR ALL USING (false);

-- device_fingerprints: only service_role can access
ALTER TABLE public.device_fingerprints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only" ON public.device_fingerprints;
CREATE POLICY "Service role only" ON public.device_fingerprints
  FOR ALL USING (false);

-- api_rate_limits: only service_role can access
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only" ON public.api_rate_limits;
CREATE POLICY "Service role only" ON public.api_rate_limits
  FOR ALL USING (false);

-- 7. Add RLS policy for promo_codes (read-only, active codes only)
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated view active codes" ON public.promo_codes;
CREATE POLICY "Authenticated view active codes" ON public.promo_codes
  FOR SELECT TO authenticated
  USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- 8. Revoke excessive permissions
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deduct_sim_credit() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sim_leaderboard() FROM PUBLIC, anon;

-- 9. Add grant for service_role on newly secured tables
GRANT ALL ON public.ai_cache TO service_role;
GRANT ALL ON public.email_otps TO service_role;
GRANT ALL ON public.device_fingerprints TO service_role;
GRANT ALL ON public.api_rate_limits TO service_role;

-- 10. Create index for rate limit bucketing (for faster lookups)
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_bucket
  ON public.api_rate_limits (bucket, window_start DESC);
