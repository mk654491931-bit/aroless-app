-- ============================================================================
--  AROLESS — Ayarlar panelleri + admin görünümü onarımı
--  Supabase Dashboard → SQL Editor → New query → yapıştır → Run
--
--  • TEKRAR ÇALIŞTIRILABİLİR (idempotent): var olan nesneleri atlar.
--  • HİÇBİR VERİ SİLMEZ / DEĞİŞTİRMEZ — yalnızca eksik olanı tamamlar.
--  • Amaç: Davet, Affiliate ve Destek panelleri ile admin'deki kayıtlar
--    çalışsın; gönderilen talepler admin listesinde görünsün.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0) TEMEL YARDIMCILAR (RBAC + kredi artırma)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS role public.app_role;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins read all roles" ON public.user_roles;
CREATE POLICY "Admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Davet bonusunu davet edenin hesabına ekler (yalnızca sunucu çağırabilir).
CREATE OR REPLACE FUNCTION public.increment_profile_credits(_profile_id uuid, _amount integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN UPDATE public.profiles SET credits = credits + _amount WHERE id = _profile_id; END; $$;
REVOKE ALL ON FUNCTION public.increment_profile_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_profile_credits(uuid, integer) TO service_role;


-- ---------------------------------------------------------------------------
-- 1) PROFILES — davet kodu (yoksa "Arkadaşını davet et" linki boş kalır)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code       text,
  ADD COLUMN IF NOT EXISTS referred_by         uuid,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.gen_referral_code()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE c text;
BEGIN
  LOOP
    c := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = c);
  END LOOP;
  RETURN c;
END; $$;

CREATE OR REPLACE FUNCTION public.set_referral_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN NEW.referral_code := public.gen_referral_code(); END IF;
  RETURN NEW;
END; $$;

UPDATE public.profiles SET referral_code = public.gen_referral_code() WHERE referral_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key ON public.profiles (referral_code);

DROP TRIGGER IF EXISTS profiles_set_referral_code ON public.profiles;
CREATE TRIGGER profiles_set_referral_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_referral_code();


-- ---------------------------------------------------------------------------
-- 2) DAVET (Arkadaşını davet et)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code              text NOT NULL,
  referrer_credits  integer NOT NULL DEFAULT 0,
  referred_credits  integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referred_user_id)
);
ALTER TABLE public.referral_events
  ADD COLUMN IF NOT EXISTS referrer_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referred_credits integer NOT NULL DEFAULT 0;

GRANT SELECT ON public.referral_events TO authenticated;
GRANT ALL ON public.referral_events TO service_role;
ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own referral events" ON public.referral_events;
CREATE POLICY "Users view own referral events" ON public.referral_events
  FOR SELECT TO authenticated
  USING (auth.uid() = referrer_id OR auth.uid() = referred_user_id);

DROP POLICY IF EXISTS "Admins view all referral events" ON public.referral_events;
CREATE POLICY "Admins view all referral events" ON public.referral_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS referral_events_referrer_idx  ON public.referral_events (referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS referral_events_referred_idx ON public.referral_events (referred_user_id);


-- ---------------------------------------------------------------------------
-- 3) DESTEK (Hata bildir) — admin'in cevap verebilmesi için UPDATE yetkisi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text,
  category   text NOT NULL DEFAULT 'general',
  subject    text NOT NULL,
  message    text NOT NULL,
  status     text NOT NULL DEFAULT 'open',
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS category   text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS status     text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS email      text;

GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own tickets" ON public.support_tickets;
CREATE POLICY "Users insert own tickets" ON public.support_tickets
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own tickets" ON public.support_tickets;
CREATE POLICY "Users view own tickets" ON public.support_tickets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage tickets" ON public.support_tickets;
CREATE POLICY "Admins manage tickets" ON public.support_tickets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS support_tickets_created_at_idx ON public.support_tickets (created_at DESC);


-- ---------------------------------------------------------------------------
-- 4) AFFILIATE PROGRAMI
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliates (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending',
  commission_rate_pct integer NOT NULL DEFAULT 30,
  verified_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliates_status_check CHECK (status IN ('pending','verified','revoked')),
  CONSTRAINT affiliates_rate_check    CHECK (commission_rate_pct BETWEEN 0 AND 100)
);

GRANT SELECT, INSERT ON public.affiliates TO authenticated;
GRANT ALL ON public.affiliates TO service_role;
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own affiliate row" ON public.affiliates;
CREATE POLICY "Users view own affiliate row" ON public.affiliates
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all affiliates" ON public.affiliates;
CREATE POLICY "Admins view all affiliates" ON public.affiliates
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_affiliates_updated_at ON public.affiliates;
CREATE TRIGGER trg_affiliates_updated_at
  BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
GRANT SELECT ON public.affiliate_commissions TO authenticated;
GRANT ALL ON public.affiliate_commissions TO service_role;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own commissions" ON public.affiliate_commissions;
CREATE POLICY "Users view own commissions" ON public.affiliate_commissions
  FOR SELECT TO authenticated USING (auth.uid() = affiliate_id);

DROP POLICY IF EXISTS "Admins view all commissions" ON public.affiliate_commissions;
CREATE POLICY "Admins view all commissions" ON public.affiliate_commissions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Admin görevlendirmesi (yalnızca admin, RBAC fonksiyonun içinde kontrol edilir)
CREATE OR REPLACE FUNCTION public.verify_affiliate(
  _admin_id uuid, _user_id uuid, _status text, _rate_pct integer
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _valid_status text := lower(btrim(COALESCE(_status, '')));
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _valid_status NOT IN ('pending','verified','revoked') THEN RAISE EXCEPTION 'invalid_status'; END IF;

  UPDATE public.affiliates
     SET status              = _valid_status,
         commission_rate_pct = GREATEST(0, LEAST(100, COALESCE(_rate_pct, commission_rate_pct))),
         verified_by         = CASE WHEN _valid_status = 'verified' THEN _admin_id ELSE verified_by END,
         verified_at         = CASE WHEN _valid_status = 'verified' THEN now() ELSE verified_at END,
         updated_at          = now()
   WHERE user_id = _user_id;

  IF NOT FOUND THEN
    INSERT INTO public.affiliates (user_id, status, commission_rate_pct, verified_by, verified_at)
    VALUES (_user_id, _valid_status,
            GREATEST(0, LEAST(100, COALESCE(_rate_pct, 30))),
            CASE WHEN _valid_status = 'verified' THEN _admin_id ELSE NULL END,
            CASE WHEN _valid_status = 'verified' THEN now() ELSE NULL END);
  END IF;

  RETURN 'ok';
END; $$;
REVOKE ALL ON FUNCTION public.verify_affiliate(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_affiliate(uuid, uuid, text, integer) TO service_role;

-- "Başvuru yap" — kullanıcı kendi başvurusunu kendi oturumuyla oluşturur.
-- Durum ve komisyon oranı SUNUCUDA sabitlenir; kullanıcı kendini onaylayamaz.
CREATE OR REPLACE FUNCTION public.apply_for_affiliate()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 'unauthorized'; END IF;
  INSERT INTO public.affiliates (user_id, status, commission_rate_pct)
  VALUES (auth.uid(), 'pending', 30)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT a.status INTO v_status FROM public.affiliates a WHERE a.user_id = auth.uid();
  RETURN COALESCE(v_status, 'pending');
END; $$;
REVOKE ALL ON FUNCTION public.apply_for_affiliate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_for_affiliate() TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5) PROMO KODLARI (admin'deki "hangi kullanıcı hangi koddan geldi" tabloları)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  discount_pct     integer NOT NULL DEFAULT 10,
  max_redemptions  integer,
  times_redeemed   integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  expires_at       timestamptz,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_codes_discount_range CHECK (discount_pct >= 1 AND discount_pct <= 100)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage promo codes" ON public.promo_codes;
CREATE POLICY "Admins manage promo codes" ON public.promo_codes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_promo_codes_updated_at ON public.promo_codes;
CREATE TRIGGER trg_promo_codes_updated_at
  BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id  uuid REFERENCES public.promo_codes(id) ON DELETE SET NULL,
  code           text NOT NULL,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email          text,
  signed_up_at   timestamptz NOT NULL DEFAULT now(),
  purchased_tier text,
  purchased_at   timestamptz,
  amount_cents   integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
GRANT SELECT ON public.promo_redemptions TO authenticated;
GRANT ALL ON public.promo_redemptions TO service_role;
ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own promo redemption" ON public.promo_redemptions;
CREATE POLICY "Users view own promo redemption" ON public.promo_redemptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all promo redemptions" ON public.promo_redemptions;
CREATE POLICY "Admins view all promo redemptions" ON public.promo_redemptions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS promo_redemptions_code_idx ON public.promo_redemptions (code);


-- ---------------------------------------------------------------------------
-- 6) KONTROL — hepsi "ok" olmalı
-- ---------------------------------------------------------------------------
SELECT 'support_tickets'  AS nesne, to_regclass('public.support_tickets')  IS NOT NULL AS ok
UNION ALL SELECT 'referral_events',  to_regclass('public.referral_events')  IS NOT NULL
UNION ALL SELECT 'affiliates',       to_regclass('public.affiliates')       IS NOT NULL
UNION ALL SELECT 'affiliate_commissions', to_regclass('public.affiliate_commissions') IS NOT NULL
UNION ALL SELECT 'promo_codes',      to_regclass('public.promo_codes')      IS NOT NULL
UNION ALL SELECT 'promo_redemptions',to_regclass('public.promo_redemptions')IS NOT NULL
UNION ALL SELECT 'apply_for_affiliate()', to_regprocedure('public.apply_for_affiliate()') IS NOT NULL
UNION ALL SELECT 'verify_affiliate()',    to_regprocedure('public.verify_affiliate(uuid,uuid,text,integer)') IS NOT NULL
UNION ALL SELECT 'increment_profile_credits()', to_regprocedure('public.increment_profile_credits(uuid,integer)') IS NOT NULL;
