-- Paddle Billing webhook entegrasyonu: profiles tablosuna abonelik alanları
-- ve webhook idempotency tablosu. idempotent — tekrar çalıştırılabilir.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paddle_customer_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paddle_subscription_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paddle_price_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paddle_subscription_status text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paddle_current_period_end timestamptz;

-- Webhook idempotency: aynı event_id tekrar gelirse ikinci işlemi atla.
CREATE TABLE IF NOT EXISTS public.paddle_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text,
  payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.paddle_webhook_events FROM PUBLIC, anon, authenticated;

-- 90 günden eski event kayıtlarını temizlemek için (opsiyonel cron).
CREATE OR REPLACE FUNCTION public.prune_paddle_webhook_events()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.paddle_webhook_events WHERE received_at < now() - interval '90 days';
$$;

REVOKE ALL ON FUNCTION public.prune_paddle_webhook_events() FROM PUBLIC, anon, authenticated;

-- Sorgular için indeksler
CREATE INDEX IF NOT EXISTS idx_profiles_paddle_subscription_id
  ON public.profiles (paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;
