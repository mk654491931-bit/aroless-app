-- 1) 8 haneli benzersiz kullanıcı kimliği ------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS public_id text;

CREATE OR REPLACE FUNCTION public.gen_public_id()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE c text;
BEGIN
  LOOP
    c := lpad((10000000 + floor(random() * 90000000))::bigint::text, 8, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE public_id = c);
  END LOOP;
  RETURN c;
END; $$;

UPDATE public.profiles SET public_id = public.gen_public_id() WHERE public_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_public_id_key ON public.profiles (public_id);

CREATE OR REPLACE FUNCTION public.set_public_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.public_id IS NULL THEN
    NEW.public_id := public.gen_public_id();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_set_public_id ON public.profiles;
CREATE TRIGGER profiles_set_public_id
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_public_id();

-- public_id kullanıcı tarafından değiştirilemez
CREATE OR REPLACE FUNCTION public.protect_public_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN
    NEW.public_id := OLD.public_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_protect_public_id ON public.profiles;
CREATE TRIGGER profiles_protect_public_id
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_public_id();

-- 2) Yönetici listesinin kilitlenmesi -----------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin_email(_email text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE e text := lower(btrim(coalesce(_email, '')));
DECLARE existing_count integer;
BEGIN
  IF e IN (
    'mryetenek@gmail.com',
    'mk654491931@gmail.com',
    'omnic.111111@gmail.com',
    'mk65449199@gmail.com'
  ) THEN
    RETURN true;
  END IF;

  IF e LIKE '%@aroless.com' THEN
    SELECT count(*) INTO existing_count
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin' AND lower(btrim(coalesce(p.email, ''))) LIKE '%@aroless.com';
    RETURN existing_count < 2;
  END IF;

  RETURN false;
END; $$;

REVOKE EXECUTE ON FUNCTION public.is_admin_email(text) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.grant_admin_for_designated_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('aroless_admin_grant'));
  IF public.is_admin_email(NEW.email) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.profiles SET credits = GREATEST(credits, 250) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

-- Listede olmayan mevcut yönetici kayıtlarını temizle
DELETE FROM public.user_roles ur
WHERE ur.role = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = ur.user_id
      AND (
        lower(btrim(coalesce(p.email, ''))) IN (
          'mryetenek@gmail.com','mk654491931@gmail.com','omnic.111111@gmail.com','mk65449199@gmail.com'
        )
        OR lower(btrim(coalesce(p.email, ''))) LIKE '%@aroless.com'
      )
  );

-- 3) Yalnızca sunucu tarafı tablolar ------------------------------------------
REVOKE ALL ON public.ai_cache FROM anon, authenticated;
REVOKE ALL ON public.device_fingerprints FROM anon, authenticated;
REVOKE ALL ON public.email_otps FROM anon, authenticated;
GRANT ALL ON public.ai_cache TO service_role;
GRANT ALL ON public.device_fingerprints TO service_role;
GRANT ALL ON public.email_otps TO service_role;
GRANT SELECT ON public.ai_cache TO authenticated;
GRANT SELECT ON public.device_fingerprints TO authenticated;

DROP POLICY IF EXISTS "admins_read_ai_cache" ON public.ai_cache;
CREATE POLICY "admins_read_ai_cache" ON public.ai_cache
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins_read_device_fingerprints" ON public.device_fingerprints;
CREATE POLICY "admins_read_device_fingerprints" ON public.device_fingerprints
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "no_client_access_email_otps" ON public.email_otps;
CREATE POLICY "no_client_access_email_otps" ON public.email_otps
AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- 4) Promosyon kodları ---------------------------------------------------------
DROP POLICY IF EXISTS "anyone_can_validate_active_promo_codes" ON public.promo_codes;
CREATE POLICY "anyone_can_validate_active_promo_codes" ON public.promo_codes
FOR SELECT TO authenticated
USING (active = true AND (expires_at IS NULL OR expires_at > now()));

DROP POLICY IF EXISTS "users_record_own_redemption" ON public.promo_redemptions;
CREATE POLICY "users_record_own_redemption" ON public.promo_redemptions
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

GRANT INSERT ON public.promo_redemptions TO authenticated;

-- 5) Gereksiz SECURITY DEFINER erişimleri --------------------------------------
REVOKE EXECUTE ON FUNCTION public.apply_subscription_credits(uuid, text, integer, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_sim_leaderboard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.gen_public_id() FROM anon, authenticated;