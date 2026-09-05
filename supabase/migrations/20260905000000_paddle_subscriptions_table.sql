-- Paddle Billing webhook → public.subscriptions tablosu.
-- Webhook çekirdeği (src/lib/paddle-webhook-core.ts) abonelik olaylarını hem
-- `profiles` (uygulamanın okuduğu kanonik durum) hem de bu tabloya senkronize
-- eder. Raporlama/denetim ve Paddle tarafı sorgular için kullanılır.
-- idempotent — tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id text PRIMARY KEY, -- Paddle subscription id (sub_...)
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id text, -- Paddle customer id (cus_...)
  status text NOT NULL, -- active / trialing / past_due / paused / canceled / expired
  price_id text, -- Paddle price id (pri_...)
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Yalnızca service_role (webhook sunucusu) erişebilir.
REVOKE ALL ON public.subscriptions FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_id
  ON public.subscriptions (customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON public.subscriptions (status);