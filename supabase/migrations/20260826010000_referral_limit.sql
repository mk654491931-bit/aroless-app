-- Bir kullanıcının davet bonusu alabileceği kayıt sayısını ikiyle sınırla.
CREATE OR REPLACE FUNCTION public.enforce_referral_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.referrer_id::text));
  IF (SELECT count(*) FROM public.referral_events WHERE referrer_id = NEW.referrer_id) >= 2 THEN
    RAISE EXCEPTION 'referral_limit_reached';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS referral_events_limit ON public.referral_events;
CREATE TRIGGER referral_events_limit
BEFORE INSERT ON public.referral_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_referral_limit();

REVOKE ALL ON FUNCTION public.enforce_referral_limit() FROM PUBLIC, anon, authenticated;