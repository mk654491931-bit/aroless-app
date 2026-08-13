CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  credits INTEGER NOT NULL DEFAULT 3,
  subscription_tier TEXT NOT NULL DEFAULT 'Free',
  lemon_customer_id TEXT,
  lemon_subscription_id TEXT,
  credits_spent integer NOT NULL DEFAULT 0,
  language text NOT NULL DEFAULT 'en',
  currency text NOT NULL DEFAULT 'USD',
  notifications_enabled boolean NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sim_credits INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, credits, sim_credits, subscription_tier)
  VALUES (
    NEW.id, NEW.email,
    CASE WHEN lower(NEW.email) = 'omnic.111111@gmail.com' THEN 250 ELSE 2 END,
    CASE WHEN lower(NEW.email) = 'omnic.111111@gmail.com' THEN 100 ELSE 1 END,
    'Free'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.deduct_credit() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE remaining INTEGER;
BEGIN
  UPDATE public.profiles
    SET credits = credits - 1, credits_spent = credits_spent + 1
    WHERE id = auth.uid() AND credits > 0
    RETURNING credits INTO remaining;
  IF remaining IS NULL THEN RAISE EXCEPTION 'no_credits'; END IF;
  RETURN remaining;
END; $$;

CREATE TABLE public.favorites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  product JSONB NOT NULL,
  collection_name text NOT NULL DEFAULT 'Default',
  notes text,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own favorites" ON public.favorites FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own favorites" ON public.favorites FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own favorites" ON public.favorites FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own favorites" ON public.favorites FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX favorites_user_created_idx ON public.favorites(user_id, created_at DESC);

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.grant_admin_for_designated_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(NEW.email) = 'omnic.111111@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.profiles SET credits = GREATEST(credits, 250) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created_grant_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_admin_for_designated_email();

CREATE TRIGGER on_auth_user_confirmed_grant_admin
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW WHEN (old.email_confirmed_at IS NULL AND new.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.grant_admin_for_designated_email();

CREATE POLICY "Admins view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins view all favorites" ON public.favorites
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text, tier text,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  payment_method text,
  provider text NOT NULL DEFAULT 'lemonsqueezy',
  provider_event text, external_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own transactions" ON public.transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all transactions" ON public.transactions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX transactions_created_at_idx ON public.transactions (created_at DESC);

CREATE TABLE public.analysis_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  search_query text NOT NULL,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.analysis_history TO authenticated;
GRANT ALL ON public.analysis_history TO service_role;
ALTER TABLE public.analysis_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own history" ON public.analysis_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own history" ON public.analysis_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own history" ON public.analysis_history FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all history" ON public.analysis_history FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX idx_analysis_history_user_created ON public.analysis_history(user_id, created_at DESC);

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, category TEXT,
  cost_price NUMERIC(10,2) NOT NULL, selling_price NUMERIC(10,2) NOT NULL,
  target_country TEXT NOT NULL DEFAULT 'US',
  trend_score INT NOT NULL DEFAULT 50,
  competition_level TEXT CHECK (competition_level IN ('Low','Medium','High')),
  profit_margin NUMERIC(5,2),
  viral_probability_90d INT NOT NULL DEFAULT 50,
  health_score INT NOT NULL DEFAULT 70,
  sellability_verdict TEXT CHECK (sellability_verdict IN ('Highly Sellable','Moderate Risk','Do Not Sell')),
  status_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own products" ON public.products FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all products" ON public.products FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX products_user_id_idx ON public.products(user_id);
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('Alibaba','1688','AliExpress','CJ Dropshipping')),
  price NUMERIC(10,2) NOT NULL, moq INT NOT NULL, delivery_days INT NOT NULL,
  rating NUMERIC(3,2), trust_score INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage suppliers of own products" ON public.suppliers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.user_id = auth.uid()));
CREATE POLICY "Admins read all suppliers" ON public.suppliers FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX suppliers_product_id_idx ON public.suppliers(product_id);

CREATE TABLE public.viral_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL, niche TEXT NOT NULL, country TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('TikTok','Facebook','Instagram')),
  views INT NOT NULL DEFAULT 0, likes INT NOT NULL DEFAULT 0,
  video_url TEXT, hook_script TEXT, cta_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.viral_ads TO authenticated;
GRANT ALL ON public.viral_ads TO service_role;
ALTER TABLE public.viral_ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read viral ads" ON public.viral_ads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage viral ads" ON public.viral_ads FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.sim_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  starting_capital NUMERIC NOT NULL,
  final_capital NUMERIC NOT NULL DEFAULT 0,
  net_profit NUMERIC NOT NULL DEFAULT 0,
  roi_pct NUMERIC NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 0,
  store_rating INTEGER NOT NULL DEFAULT 100,
  badges JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.sim_runs TO authenticated;
GRANT ALL ON public.sim_runs TO service_role;
ALTER TABLE public.sim_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own runs" ON public.sim_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all runs" ON public.sim_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own runs" ON public.sim_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own runs" ON public.sim_runs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX sim_runs_roi_idx ON public.sim_runs (roi_pct DESC);

CREATE OR REPLACE FUNCTION public.deduct_sim_credit()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE remaining INTEGER;
BEGIN
  UPDATE public.profiles
    SET sim_credits = sim_credits - 1
    WHERE id = auth.uid() AND sim_credits > 0
    RETURNING sim_credits INTO remaining;
  IF remaining IS NULL THEN RAISE EXCEPTION 'no_sim_credits'; END IF;
  RETURN remaining;
END; $$;

CREATE OR REPLACE FUNCTION public.get_sim_leaderboard()
RETURNS TABLE (id uuid, store_name text, platform text, roi_pct numeric, net_profit numeric, orders integer, store_rating integer, created_at timestamptz, is_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.id, r.store_name, r.platform, r.roi_pct, r.net_profit, r.orders,
         r.store_rating, r.created_at, (r.user_id = auth.uid()) AS is_me
  FROM public.sim_runs r
  ORDER BY r.roi_pct DESC
  LIMIT 20
$$;

CREATE OR REPLACE FUNCTION public.apply_subscription_credits(_user_id uuid, _tier text, _credits integer, _customer_id text, _subscription_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  search_credits integer;
  sim_add integer;
BEGIN
  IF lower(_tier) = 'pro' THEN
    search_credits := 20; sim_add := 10;
  ELSIF lower(_tier) = 'starter' THEN
    search_credits := 10; sim_add := 5;
  ELSE
    search_credits := GREATEST(COALESCE(_credits, 0), 0);
    sim_add := GREATEST(1, search_credits / 2);
  END IF;

  UPDATE public.profiles
  SET subscription_tier = _tier,
      credits = credits + search_credits,
      sim_credits = sim_credits + sim_add,
      lemon_customer_id = COALESCE(_customer_id, lemon_customer_id),
      lemon_subscription_id = COALESCE(_subscription_id, lemon_subscription_id)
  WHERE id = _user_id;
END; $function$;

REVOKE ALL ON FUNCTION public.apply_subscription_credits(uuid, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_credits(uuid, text, integer, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_admin_for_designated_email() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deduct_credit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_credit() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.deduct_sim_credit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_sim_credit() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_sim_leaderboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sim_leaderboard() TO authenticated, service_role;

DO $$
DECLARE _uid uuid;
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = 'omnic.111111@gmail.com' LIMIT 1;
  IF _uid IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, credits, sim_credits, subscription_tier)
      VALUES (_uid, 'omnic.111111@gmail.com', 250, 100, 'Free')
      ON CONFLICT (id) DO UPDATE SET credits = 250, sim_credits = 100;
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END $$;

CREATE TABLE public.scraped_platform_trends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  trend_name text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  region text NOT NULL DEFAULT 'GLOBAL',
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_demand_score integer,
  ai_analysis jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scraped_platform_trends_uniq
  ON public.scraped_platform_trends (source, lower(trend_name), region);
CREATE INDEX scraped_platform_trends_scraped_at_idx
  ON public.scraped_platform_trends (scraped_at DESC);
GRANT SELECT ON public.scraped_platform_trends TO authenticated;
GRANT ALL ON public.scraped_platform_trends TO service_role;
ALTER TABLE public.scraped_platform_trends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read scraped trends"
  ON public.scraped_platform_trends FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage scraped trends"
  ON public.scraped_platform_trends FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_scraped_platform_trends_updated_at
  BEFORE UPDATE ON public.scraped_platform_trends
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all notifications" ON public.notifications
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.notification_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  low_credit boolean NOT NULL DEFAULT true,
  trend_alert boolean NOT NULL DEFAULT true,
  payment_success boolean NOT NULL DEFAULT true,
  marketing boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notification preferences" ON public.notification_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all notification preferences" ON public.notification_preferences
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.favorites ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.notify_low_credit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  prefs public.notification_preferences%ROWTYPE;
BEGIN
  IF NEW.credits <= 5 AND OLD.credits > 5 THEN
    SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.id;
    IF prefs.low_credit IS NOT FALSE THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (NEW.id, 'low_credit', 'Krediniz azaldi', 'Kredi bakiyeniz 5''in altina dustu. Yeni kredi yuklemek icin ayarlara gidin.', jsonb_build_object('credits', NEW.credits));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_low_credit ON public.profiles;
CREATE TRIGGER trg_notify_low_credit
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_low_credit();

CREATE OR REPLACE FUNCTION public.notify_credit_topup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  prefs public.notification_preferences%ROWTYPE;
BEGIN
  IF NEW.credits > OLD.credits THEN
    SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.id;
    IF prefs.payment_success IS NOT FALSE THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (NEW.id, 'payment_success', 'Kredi yuklendi', 'Hesabiniza yeni kredi eklendi.', jsonb_build_object('credits', NEW.credits));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_credit_topup ON public.profiles;
CREATE TRIGGER trg_notify_credit_topup
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_credit_topup();

INSERT INTO public.notification_preferences (user_id, low_credit, trend_alert, payment_success, marketing)
SELECT id, true, true, true, false FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

REVOKE EXECUTE ON FUNCTION public.notify_low_credit() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.notify_credit_topup() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.notify_low_credit() TO postgres;
GRANT EXECUTE ON FUNCTION public.notify_credit_topup() TO postgres;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO postgres;

CREATE TABLE public.email_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_otps_email ON public.email_otps (lower(email), created_at DESC);
GRANT ALL ON public.email_otps TO service_role;
ALTER TABLE public.email_otps ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.device_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  free_tier_granted boolean NOT NULL DEFAULT false,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_device_fingerprints_visitor ON public.device_fingerprints (visitor_id);
CREATE INDEX device_fingerprints_ip_idx ON public.device_fingerprints (ip_hash);
GRANT ALL ON public.device_fingerprints TO service_role;
ALTER TABLE public.device_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  discount_pct integer NOT NULL DEFAULT 10,
  max_redemptions integer,
  times_redeemed integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_codes_discount_range CHECK (discount_pct >= 1 AND discount_pct <= 100)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage promo codes"
ON public.promo_codes FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_promo_codes_updated_at
BEFORE UPDATE ON public.promo_codes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.ai_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  scope text not null default 'council',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS ai_cache_expires_idx ON public.ai_cache (expires_at);
GRANT ALL ON public.ai_cache TO service_role;
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS promo_code text;

CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid REFERENCES public.promo_codes(id) ON DELETE SET NULL,
  code text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  signed_up_at timestamptz NOT NULL DEFAULT now(),
  purchased_tier text,
  purchased_at timestamptz,
  amount_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS promo_redemptions_code_idx ON public.promo_redemptions (code);
GRANT SELECT ON public.promo_redemptions TO authenticated;
GRANT ALL ON public.promo_redemptions TO service_role;
ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own promo redemption"
ON public.promo_redemptions FOR SELECT TO authenticated
USING (auth.uid() = user_id);
CREATE POLICY "Admins view all promo redemptions"
ON public.promo_redemptions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));