-- ============================================================================
-- FAZ 1 — Affiliate programı uçtan uca: promo kodu köprüsü + manuel ödeme (Wise/IBAN)
--
-- Eklenenler:
--   1. promo_codes.affiliate_id  — bir promosyon kodu bir affiliate'e bağlanır.
--   2. affiliate_commissions payout kolonları — status/paid_at/paid_method/
--      payout_ref/reversed_at/reversed_reason. Ödeme ve mahsup burada izlenir.
--   3. affiliates.payout_method / payout_note — influencer'ın ödeme bilgisi
--      (admin elle girer; IBAN/Wise koordinasyonu buradan yürür).
--   4. public.affiliate_payout_summary()   — affiliate başına pending/paid özeti.
--   5. public.admin_mark_affiliate_paid()  — pending komisyonları TOPLU "ödendi"
--      işaretler; 75$ (7500 cent) altındaysa reddeder (ödeme eşiği).
--   6. public.admin_reverse_commission()   — admin manuel mahsup.
--   7. public.process_paddle_refund()      — iade/chargeback'te otomatik mahsup.
--   8. public.process_paddle_event()       — YENİDEN tanımlandı; komisyon artık
--      referred_by VEYA kullanıcının promo kodunun affiliate'i üzerinden çözülür.
--      Böylece "kodla gelen kullanıcı plan alınca %30" zinciri gerçekten çalışır.
--
-- ÖDEME KURALI (iş kuralı, DB'de de zorlanır):
--   Bir affiliate'e ödeme, BİRİKMİŞ (pending) komisyonu >= $75 olduğunda yapılır.
--   Altındaysa bakiye devreder (banka/Wise masrafı boşa gitmesin).
--
-- Güvenlik: para ile ilgili yazmalar yalnız service_role + SECURITY DEFINER.
-- Idempotenttir; 20260915000000_settings_panels_rls.sql'den sonra çalışır.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) promo_codes.affiliate_id — kodun sahibi influencer
-- ---------------------------------------------------------------------------
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS affiliate_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_promo_codes_affiliate
  ON public.promo_codes (affiliate_id)
  WHERE affiliate_id IS NOT NULL;

COMMENT ON COLUMN public.promo_codes.affiliate_id IS
  'Influencer (auth.users.id) who owns this promo code; commissions on code-driven signups go to them.';

-- ---------------------------------------------------------------------------
-- 2) affiliate_commissions — ödeme/mahsup durumu
-- ---------------------------------------------------------------------------
ALTER TABLE public.affiliate_commissions
  ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS paid_at          timestamptz,
  ADD COLUMN IF NOT EXISTS paid_method      text,
  ADD COLUMN IF NOT EXISTS payout_ref       text,
  ADD COLUMN IF NOT EXISTS reversed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_reason  text;

-- status kısıtı (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'affiliate_commissions_status_check'
      AND conrelid = 'public.affiliate_commissions'::regclass
  ) THEN
    ALTER TABLE public.affiliate_commissions
      ADD CONSTRAINT affiliate_commissions_status_check
      CHECK (status IN ('pending', 'paid', 'reversed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate_status
  ON public.affiliate_commissions (affiliate_id, status);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_status
  ON public.affiliate_commissions (status, created_at DESC);

COMMENT ON COLUMN public.affiliate_commissions.status IS
  'pending = henüz ödenmedi, paid = influencer''a gönderildi, reversed = iade/chargeback ile mahsup.';
COMMENT ON COLUMN public.affiliate_commissions.payout_ref IS
  'Ödeme referansı (Wise transfer no / banka dekont no) — aynı partideki satırlar aynı referansı taşır.';

-- ---------------------------------------------------------------------------
-- 3) affiliates — influencer ödeme bilgisi (elle girilir)
-- ---------------------------------------------------------------------------
ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS payout_method text,
  ADD COLUMN IF NOT EXISTS payout_note   text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'affiliates_payout_method_check'
      AND conrelid = 'public.affiliates'::regclass
  ) THEN
    ALTER TABLE public.affiliates
      ADD CONSTRAINT affiliates_payout_method_check
      CHECK (payout_method IS NULL OR payout_method IN ('wise', 'iban', 'other'));
  END IF;
END $$;

COMMENT ON COLUMN public.affiliates.payout_note IS
  'Ödeme koordinasyon notu (IBAN / Wise e-postası / vergi no). Kişisel veri: RLS korumalı.';

-- ---------------------------------------------------------------------------
-- 4) affiliate_payout_summary() — affiliate başına pending/paid özeti
--    Tek sorguda toplanır (satır satır çekmek yerine) — optimize.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.affiliate_payout_summary()
RETURNS TABLE (
  affiliate_id   uuid,
  pending_cents  bigint,
  pending_count  bigint,
  paid_cents     bigint,
  paid_count     bigint,
  reversed_cents bigint,
  last_paid_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    c.affiliate_id,
    COALESCE(SUM(c.commission_cents) FILTER (WHERE c.status = 'pending'), 0)::bigint,
    COUNT(*) FILTER (WHERE c.status = 'pending')::bigint,
    COALESCE(SUM(c.commission_cents) FILTER (WHERE c.status = 'paid'), 0)::bigint,
    COUNT(*) FILTER (WHERE c.status = 'paid')::bigint,
    COALESCE(SUM(c.commission_cents) FILTER (WHERE c.status = 'reversed'), 0)::bigint,
    MAX(c.paid_at) FILTER (WHERE c.status = 'paid')
  FROM public.affiliate_commissions c
  GROUP BY c.affiliate_id;
$function$;

REVOKE ALL ON FUNCTION public.affiliate_payout_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_payout_summary() TO service_role;

COMMENT ON FUNCTION public.affiliate_payout_summary() IS
  'Per-affiliate commission totals by status (service_role only) for the payout screen.';

-- ---------------------------------------------------------------------------
-- 5) admin_mark_affiliate_paid() — toplu "ödendi" işareti + 75$ eşiği
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_mark_affiliate_paid(
  _admin_id     uuid,
  _affiliate_id uuid,
  _method       text,
  _reference    text
) RETURNS TABLE (paid_cents bigint, paid_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _ref       text := NULLIF(btrim(COALESCE(_reference, '')), '');
  _pending   bigint;
  _total     bigint;
  _count     bigint;
BEGIN
  -- RBAC: yalnız admin.
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF lower(btrim(COALESCE(_method, ''))) NOT IN ('wise', 'iban', 'other') THEN
    RAISE EXCEPTION 'invalid_method';
  END IF;

  -- Ödeme eşiği: birikmiş komisyon 75$ (7500 cent) altındaysa ödeme yapılmaz.
  SELECT COALESCE(SUM(commission_cents), 0)::bigint
    INTO _pending
  FROM public.affiliate_commissions
  WHERE affiliate_id = _affiliate_id AND status = 'pending';

  IF _pending < 7500 THEN
    RAISE EXCEPTION 'below_threshold';
  END IF;

  -- Referans verilmediyse parti referansı üret (aynı partideki satırlar aynı ref'i taşır).
  IF _ref IS NULL THEN
    _ref := 'PAY-' || to_char(now(), 'YYYYMMDD-HH24MISS');
  END IF;

  WITH updated AS (
    UPDATE public.affiliate_commissions
    SET status        = 'paid',
        paid_at       = now(),
        paid_method   = lower(btrim(_method)),
        payout_ref    = _ref,
        reversed_at   = NULL,
        reversed_reason = NULL
    WHERE affiliate_id = _affiliate_id
      AND status = 'pending'
    RETURNING commission_cents
  )
  SELECT COALESCE(SUM(commission_cents), 0)::bigint, COUNT(*)::bigint
    INTO _total, _count
  FROM updated;

  RETURN QUERY SELECT _total, _count;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_mark_affiliate_paid(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_affiliate_paid(uuid, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.admin_mark_affiliate_paid(uuid, uuid, text, text) IS
  'Admin-only: marks all pending commissions of an affiliate as paid (min $75 enforced).';

-- ---------------------------------------------------------------------------
-- 6) admin_reverse_commission() — admin manuel mahsup (iade/chargeback)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reverse_commission(
  _admin_id      uuid,
  _commission_id uuid,
  _reason        text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.affiliate_commissions
  SET status          = 'reversed',
      reversed_at     = now(),
      reversed_reason = COALESCE(NULLIF(btrim(COALESCE(_reason, '')), ''), 'manual')
  WHERE id = _commission_id;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  RETURN 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reverse_commission(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reverse_commission(uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.admin_reverse_commission(uuid, uuid, text) IS
  'Admin-only manual reversal of a single commission line (refund / chargeback / correction).';

-- ---------------------------------------------------------------------------
-- 7) process_paddle_refund() — iade/chargeback'te otomatik mahsup
--    Aynı iade birden çok olayla gelse bile dedupe ile tek kez uygulanır.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_paddle_refund(
  _event_id       text,
  _event_type     text,
  _occurred_at    timestamptz,
  _transaction_id text,
  _reason         text,
  _payload        jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at, payload)
  VALUES (_event_id, _event_type, COALESCE(_occurred_at, now()), COALESCE(_payload, '{}'::jsonb))
  ON CONFLICT (event_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  IF _transaction_id IS NOT NULL AND _transaction_id <> '' THEN
    UPDATE public.affiliate_commissions
    SET status          = 'reversed',
        reversed_at     = now(),
        reversed_reason = COALESCE(NULLIF(btrim(COALESCE(_reason, '')), ''), 'refund')
    WHERE transaction_id = _transaction_id
      AND status <> 'reversed';
  END IF;

  RETURN 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.process_paddle_refund(text, text, timestamptz, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_paddle_refund(text, text, timestamptz, text, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.process_paddle_refund(text, text, timestamptz, text, text, jsonb) IS
  'Idempotent refund processor: reverses the commission tied to a refunded transaction.';

-- ============================================================================
-- 8) process_paddle_event() — yeniden tanım (promo kodu köprüsü dahil)
--
--    Önceki sürümden TEK fark adım 8'dir: affiliate artık yalnız
--    profiles.referred_by ile değil, kullanıcının KULLANDIĞI promo kodunun
--    affiliate_id'si ile de de çözülür. Böylece "promo kodla gelen kullanıcı
--    plan alınca %30 komisyon" akışı uçtan uca çalışır. Yeni satırlar
--    status='pending' doğar; ödeme admin_mark_affiliate_paid() ile yapılır.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_paddle_event(
  _event_id                 text,
  _event_type               text,
  _occurred_at              timestamptz,
  _user_id                  uuid,
  _tier                     text,          -- 'Starter'|'Pro'|'Business'|'Free' | NULL = preserve
  _status                   text,          -- active|trialing|canceled|past_due|paused
  _paddle_subscription_id   text,
  _paddle_customer_id       text,
  _price_id                 text,
  _currency                 text,
  _amount_cents             bigint,
  _period_start             timestamptz,
  _period_end               timestamptz,
  _next_billed_at           timestamptz,
  _transaction_id           text,
  _cancel_at_period_end     boolean,
  _search_credits           integer,
  _sim_credits              integer,
  _payload                  jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _effective_tier   text;
  _effective_status text;
  _alt_tier         text;
  _alt_sub_id       text;
  _use_alt          boolean := false;
BEGIN
  -- 1) Idempotency — the dedupe insert and every write below are in ONE
  --    transaction, so a rolled-back attempt leaves nothing behind.
  INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at, payload)
  VALUES (_event_id, _event_type, COALESCE(_occurred_at, now()), COALESCE(_payload, '{}'::jsonb))
  ON CONFLICT (event_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  -- 2) Subscription ledger upsert.
  IF _paddle_subscription_id IS NOT NULL AND _paddle_subscription_id <> '' THEN
    INSERT INTO public.subscriptions AS s (
      user_id, paddle_subscription_id, paddle_customer_id, tier, status, price_id, currency,
      current_period_start, current_period_end, next_billed_at, cancel_at_period_end, canceled_at
    ) VALUES (
      _user_id,
      _paddle_subscription_id,
      _paddle_customer_id,
      COALESCE(NULLIF(_tier, ''), 'Pro'),
      COALESCE(NULLIF(_status, ''), 'none'),
      _price_id,
      _currency,
      _period_start,
      _period_end,
      _next_billed_at,
      COALESCE(_cancel_at_period_end, false),
      CASE WHEN _status IN ('canceled', 'past_due', 'paused')
           THEN COALESCE(_occurred_at, now()) ELSE NULL END
    )
    ON CONFLICT (paddle_subscription_id) DO UPDATE SET
      user_id               = EXCLUDED.user_id,
      paddle_customer_id    = COALESCE(EXCLUDED.paddle_customer_id, s.paddle_customer_id),
      tier                  = CASE WHEN EXCLUDED.tier IS NOT NULL THEN EXCLUDED.tier ELSE s.tier END,
      status                = EXCLUDED.status,
      price_id              = COALESCE(EXCLUDED.price_id, s.price_id),
      currency              = COALESCE(EXCLUDED.currency, s.currency),
      current_period_start  = COALESCE(EXCLUDED.current_period_start, s.current_period_start),
      current_period_end    = COALESCE(EXCLUDED.current_period_end, s.current_period_end),
      next_billed_at        = COALESCE(EXCLUDED.next_billed_at, s.next_billed_at),
      cancel_at_period_end  = COALESCE(EXCLUDED.cancel_at_period_end, s.cancel_at_period_end),
      canceled_at           = COALESCE(EXCLUDED.canceled_at, s.canceled_at);
  END IF;

  -- 3) Effective tier/status for the profile mirror.
  SELECT tier, status
    INTO _effective_tier, _effective_status
  FROM public.subscriptions
  WHERE paddle_subscription_id = _paddle_subscription_id;

  _effective_tier   := COALESCE(NULLIF(_tier, ''), _effective_tier, 'Pro');
  _effective_status := COALESCE(NULLIF(_status, ''), _effective_status, 'active');

  -- 4) Revoking event (canceled / past_due / paused)? Keep access when the user
  --    still has ANOTHER live subscription (upgrade flows cancel the old one).
  IF _effective_status IN ('canceled', 'past_due', 'paused') THEN
    SELECT s2.tier, s2.paddle_subscription_id
      INTO _alt_tier, _alt_sub_id
    FROM public.subscriptions s2
    WHERE s2.user_id = _user_id
      AND s2.paddle_subscription_id IS DISTINCT FROM _paddle_subscription_id
      AND s2.status IN ('active', 'trialing')
    ORDER BY s2.updated_at DESC
    LIMIT 1;

    IF FOUND THEN
      _use_alt          := true;
      _effective_tier   := _alt_tier;
      _effective_status := 'active';
    ELSE
      _effective_tier := 'Free';
    END IF;
  END IF;

  -- 5) Profile mirror + credit top-up.
  UPDATE public.profiles
  SET subscription_tier      = _effective_tier,
      subscription_status    = _effective_status,
      paddle_subscription_id = CASE
                                 WHEN _use_alt THEN _alt_sub_id
                                 ELSE COALESCE(NULLIF(_paddle_subscription_id, ''), paddle_subscription_id)
                               END,
      paddle_customer_id     = COALESCE(NULLIF(_paddle_customer_id, ''), paddle_customer_id),
      paddle_price_id        = COALESCE(NULLIF(_price_id, ''), paddle_price_id),
      current_period_start   = COALESCE(_period_start, current_period_start),
      current_period_end     = COALESCE(_period_end, current_period_end),
      next_billed_at         = COALESCE(_next_billed_at, next_billed_at),
      credits                = credits + GREATEST(COALESCE(_search_credits, 0), 0),
      sim_credits            = sim_credits + GREATEST(COALESCE(_sim_credits, 0), 0),
      updated_at             = now()
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE WARNING '[paddle] profile row missing for user % (event %)', _user_id, _event_id;
  END IF;

  -- 6) Transaction ledger for actual payments.
  IF _transaction_id IS NOT NULL AND _transaction_id <> '' THEN
    INSERT INTO public.transactions (
      user_id, email, tier, amount_cents, currency, payment_method,
      provider, provider_event, external_id, created_at
    ) VALUES (
      _user_id,
      NULL,
      _effective_tier,
      COALESCE(_amount_cents, 0)::integer,
      COALESCE(NULLIF(_currency, ''), 'USD'),
      'paddle',
      'paddle',
      _event_type,
      _transaction_id,
      COALESCE(_occurred_at, now())
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- 7) Mark promo redemption as purchased (admin reporting) — first payment only.
  IF _transaction_id IS NOT NULL
     AND _amount_cents IS NOT NULL
     AND _amount_cents > 0 THEN
    UPDATE public.promo_redemptions
    SET purchased_tier = _effective_tier,
        purchased_at   = now(),
        amount_cents   = _amount_cents::integer
    WHERE user_id = _user_id
      AND purchased_at IS NULL;
  END IF;

  -- 8) Affiliate recurring commission — verified affiliates only.
  --    AFFILIATE ÇÖZÜMÜ: önce profiles.referred_by (davet), yoksa kullanıcının
  --    kullandığı promo kodunun sahibi (promo_codes.affiliate_id). İki yoldan
  --    hangisi doğrulanmış bir affiliate'e çıkıyorsa komisyon ona yazılır.
  --    Same-transaction + UNIQUE(transaction_id) = idempotent by construction.
  IF _transaction_id IS NOT NULL AND _transaction_id <> ''
     AND _amount_cents IS NOT NULL AND _amount_cents >= 100 THEN
    WITH src AS (
      SELECT p.referred_by, p.promo_code
      FROM public.profiles p
      WHERE p.id = _user_id
    ),
    resolved AS (
      SELECT a.user_id, a.commission_rate_pct
      FROM public.affiliates a
      JOIN src ON TRUE
      WHERE a.status = 'verified'
        AND a.commission_rate_pct > 0
        AND (
          a.user_id = src.referred_by
          OR a.user_id = (
            SELECT pc.affiliate_id
            FROM public.promo_codes pc
            WHERE pc.affiliate_id IS NOT NULL
              AND upper(pc.code) = upper(src.promo_code)
          )
        )
      -- referred_by eşleşmesi varsa onu tercih et.
      ORDER BY (a.user_id = src.referred_by) DESC
      LIMIT 1
    )
    INSERT INTO public.affiliate_commissions (
      affiliate_id, referred_user_id, subscription_id, tier,
      gross_amount_cents, commission_rate_pct, commission_cents, transaction_id, status
    )
    SELECT resolved.user_id, _user_id, _paddle_subscription_id, _effective_tier,
           _amount_cents::integer, resolved.commission_rate_pct,
           GREATEST(1, round(_amount_cents * resolved.commission_rate_pct / 100.0))::integer,
           _transaction_id, 'pending'
    FROM resolved
    ON CONFLICT (transaction_id) DO NOTHING;
  END IF;

  RETURN 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.process_paddle_event(
  text, text, timestamptz, uuid, text, text, text, text, text, text,
  bigint, timestamptz, timestamptz, timestamptz, text, boolean, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_paddle_event(
  text, text, timestamptz, uuid, text, text, text, text, text, text,
  bigint, timestamptz, timestamptz, timestamptz, text, boolean, integer, integer, jsonb
) TO service_role;
