-- 1. Profiles: referral + onboarding
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by uuid,
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

UPDATE public.profiles SET referral_code = public.gen_referral_code() WHERE referral_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key ON public.profiles (referral_code);

CREATE OR REPLACE FUNCTION public.set_referral_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := public.gen_referral_code();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_set_referral_code ON public.profiles;
CREATE TRIGGER profiles_set_referral_code
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_referral_code();

-- 2. Referral events
CREATE TABLE IF NOT EXISTS public.referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL,
  referrer_credits integer NOT NULL DEFAULT 0,
  referred_credits integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (referred_user_id)
);

GRANT SELECT ON public.referral_events TO authenticated;
GRANT ALL ON public.referral_events TO service_role;
ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own referral events" ON public.referral_events
FOR SELECT TO authenticated
USING (auth.uid() = referrer_id OR auth.uid() = referred_user_id);

CREATE POLICY "Admins view all referral events" ON public.referral_events
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Support tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  category text NOT NULL DEFAULT 'general',
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  admin_note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own tickets" ON public.support_tickets
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own tickets" ON public.support_tickets
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins manage tickets" ON public.support_tickets
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER support_tickets_updated_at
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Credit usage log
CREATE TABLE IF NOT EXISTS public.credit_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool text NOT NULL,
  credits integer NOT NULL DEFAULT 1,
  model text,
  duration_ms integer,
  success boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.credit_usage_log TO authenticated;
GRANT ALL ON public.credit_usage_log TO service_role;
ALTER TABLE public.credit_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own credit usage" ON public.credit_usage_log
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins view all credit usage" ON public.credit_usage_log
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS credit_usage_log_user_created_idx ON public.credit_usage_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON public.support_tickets (status, created_at DESC);