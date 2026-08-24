ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credits_reset_at date;

CREATE OR REPLACE FUNCTION public.deduct_credit()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE remaining INTEGER;
BEGIN
  -- Ücretsiz plan: her gün 2 krediye sıfırlanır.
  UPDATE public.profiles
    SET credits = 2, credits_reset_at = current_date
    WHERE id = auth.uid()
      AND lower(coalesce(subscription_tier, 'free')) = 'free'
      AND (credits_reset_at IS NULL OR credits_reset_at < current_date);

  UPDATE public.profiles
    SET credits = credits - 1, credits_spent = credits_spent + 1
    WHERE id = auth.uid() AND credits > 0
    RETURNING credits INTO remaining;
  IF remaining IS NULL THEN RAISE EXCEPTION 'no_credits'; END IF;
  RETURN remaining;
END; $function$;