-- 1) Günlük/aylık ücretsiz kredi yenilemesini kaldır
CREATE OR REPLACE FUNCTION public.deduct_credit()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE remaining INTEGER;
BEGIN
  -- Ücretsiz planda kredi yenilenmez: sadece kayıt anında tek seferlik 2 kredi verilir.
  UPDATE public.profiles
    SET credits = credits - 1, credits_spent = credits_spent + 1
    WHERE id = auth.uid() AND credits > 0
    RETURNING credits INTO remaining;
  IF remaining IS NULL THEN RAISE EXCEPTION 'no_credits'; END IF;
  RETURN remaining;
END; $function$;

-- 2) Varsa kredi sıfırlama cron işlerini kaldır
DO $$
DECLARE j record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR j IN EXECUTE 'SELECT jobname FROM cron.job WHERE jobname ILIKE ''%credit%'' OR command ILIKE ''%credits%''' LOOP
      EXECUTE format('SELECT cron.unschedule(%L)', j.jobname);
    END LOOP;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3) Tek seferlik hoş geldin kredisi izleme sütunu
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS welcome_credits_granted_at timestamptz;
UPDATE public.profiles SET welcome_credits_granted_at = COALESCE(welcome_credits_granted_at, created_at);