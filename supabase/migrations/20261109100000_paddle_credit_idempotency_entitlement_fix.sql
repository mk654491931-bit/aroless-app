-- ============================================================================
-- PADDLE YETKİ DÜZELTMESİ — çözülemeyen tier artık 'Pro' VARSAYILMAZ.
--
-- ÖLÇÜLEN HATA: `process_paddle_event()` iki yerde `COALESCE(..., 'Pro')`
-- kullanıyordu. `_tier` NULL geldiğinde (fiyat ID'si env ile eşleşmedi,
-- customData kopyalanmadı ya da Paddle API o an yanıt vermedi) abonelik
-- defterine ve profile **Pro** yazılıyordu. Bu iki yönlü bir hatadır:
--   • Starter/Business satın alan kullanıcı yanlış pakete düşebilir,
--   • hiçbir paket çözülemeyen bir olay (ör. sahipsiz/eksik payload) ödeme
--     yapılmamış hesaba ücretli yetki verebilir.
--
-- DOĞRU KURAL: `_tier` NULL = "mevcut yetkiyi KORU" (parametre sözleşmesi
-- zaten bunu söylüyor). Yeni satır için profil mevcut tier'ı kullanılır;
-- profil de yoksa 'Free' yazılır. İptal/gecikme olayları (`_tier = 'Free'`)
-- bu kuraldan ETKİLENMEZ; onlar açıkça Free'ye indirir.
--
-- KREDİ DEFTERİ KORUNUR: bu göç, `20261016000000_paddle_credit_idempotency`
-- içindeki işlem-başına-tek kredi bekçisini AYNEN taşır; yalnız tier
-- varsayılanları değişir. İmza ve yetkiler değişmez.
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
  _search_grant     integer := GREATEST(COALESCE(_search_credits, 0), 0);
  _sim_grant        integer := GREATEST(COALESCE(_sim_credits, 0), 0);
  _ledger_available boolean;
  _ledger_claimed   boolean := false;
  _ledger_id        bigint;
  _ledger_key       text;
BEGIN
  -- 1) Idempotency — the dedupe insert and every write below are in ONE
  --    transaction, so a rolled-back attempt leaves nothing behind.
  INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at, payload)
  VALUES (_event_id, _event_type, COALESCE(_occurred_at, now()), COALESCE(_payload, '{}'::jsonb))
  ON CONFLICT (event_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  -- 2) Subscription ledger upsert. Tier fallback: mevcut profil → 'Free'.
  --    Pro varsayılanı KALDIRILDI (dosya başlığındaki ölçülen hata).
  IF _paddle_subscription_id IS NOT NULL AND _paddle_subscription_id <> '' THEN
    INSERT INTO public.subscriptions AS s (
      user_id, paddle_subscription_id, paddle_customer_id, tier, status, price_id, currency,
      current_period_start, current_period_end, next_billed_at, cancel_at_period_end, canceled_at
    ) VALUES (
      _user_id,
      _paddle_subscription_id,
      _paddle_customer_id,
      COALESCE(
        NULLIF(_tier, ''),
        (SELECT COALESCE(NULLIF(p.subscription_tier, ''), 'Free')
           FROM public.profiles p WHERE p.id = _user_id),
        'Free'
      ),
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
      tier                  = CASE
                                WHEN NULLIF(_tier, '') IS NOT NULL THEN _tier
                                ELSE COALESCE(s.tier, 'Free')
                              END,
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
  --
  --    `_tier` NULL ise defter satırındaki tier'a değil, ÖNCE profildeki
  --    mevcut tier'a güvenilir: defter satırı bu olayda yeni oluşturulmuş
  --    olabilir ve fallback 'Free'dir. Böylece "tier yok" bilgisi mevcut
  --    ücretli yetkiyi SİLMEZ. `_tier = 'Free'` ise açık indirme korunur.
  SELECT status INTO _effective_status
  FROM public.subscriptions
  WHERE paddle_subscription_id = _paddle_subscription_id;

  IF NULLIF(_tier, '') IS NOT NULL THEN
    _effective_tier := _tier;
  ELSE
    SELECT COALESCE(NULLIF(p.subscription_tier, ''), 'Free')
      INTO _effective_tier
    FROM public.profiles p
    WHERE p.id = _user_id;
  END IF;

  _effective_status := COALESCE(NULLIF(_status, ''), _effective_status, 'none');
  _effective_tier   := COALESCE(NULLIF(_effective_tier, ''), 'Free');

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

  -- 5) Profile ENTITLEMENT mirror — kredi BURADA eklenmez.
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

  -- 7) KREDİ — İŞLEM başına BİR kez. Talep defterin TEKİL indeksiyle yapılır:
  --    aynı `ref_key` ikinci kez yazılamaz, yazan olmadıysa kredi ARTMAZ.
  IF _search_grant > 0 OR _sim_grant > 0 THEN
    _ledger_key       := 'paddle:' || COALESCE(NULLIF(_transaction_id, ''), _event_id);
    _ledger_available := to_regclass('public.credit_ledger') IS NOT NULL;
    _ledger_claimed   := true;   -- defter yoksa eski davranış: kredi kaybolmaz

    IF _ledger_available THEN
      INSERT INTO public.credit_ledger (user_id, delta, reason, ref_key, metadata)
      VALUES (
        _user_id,
        _search_grant,
        'paddle',
        _ledger_key,
        jsonb_build_object(
          'transaction_id', _transaction_id,
          'event_id',       _event_id,
          'event_type',     _event_type,
          'tier',           _effective_tier,
          'search_credits', _search_grant,
          'sim_credits',    _sim_grant,
          'amount_cents',   _amount_cents
        )
      )
      ON CONFLICT (ref_key) WHERE ref_key IS NOT NULL DO NOTHING
      RETURNING id INTO _ledger_id;

      _ledger_claimed := _ledger_id IS NOT NULL;
      IF NOT _ledger_claimed THEN
        RAISE WARNING
          '[paddle] kredi zaten verilmiş (ref_key=%, event=%) — ikinci kez eklenmedi',
          _ledger_key, _event_id;
      END IF;
    END IF;

    IF _ledger_claimed THEN
      UPDATE public.profiles
      SET credits     = credits + _search_grant,
          sim_credits = sim_credits + _sim_grant,
          updated_at  = now()
      WHERE id = _user_id;
    END IF;
  END IF;

  -- 8) Mark promo redemption as purchased (admin reporting) — first payment only.
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

  -- 9) Affiliate recurring commission — verified affiliates only.
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

COMMENT ON FUNCTION public.process_paddle_event(
  text, text, timestamptz, uuid, text, text, text, text, text, text,
  bigint, timestamptz, timestamptz, timestamptz, text, boolean, integer, integer, jsonb
) IS 'Atomic Paddle webhook processor (dedupe + subscription + preserved-tier profile + ledger-claimed credits + transaction)';
