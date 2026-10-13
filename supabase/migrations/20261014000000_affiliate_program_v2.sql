-- ============================================================================
-- AFFILIATE PROGRAMI v2 — bekleme süresi, yapılandırılmış ödeme bilgisi,
-- başvuru detayları ve İNDİRİM KODU → affiliate atfı.
--
-- Eklenenler:
--   1. affiliates: başvuru detayları (audience/channels/social_handle),
--      şart kabul zamanı (terms_accepted_at) ve yapılandırılmış ödeme bilgisi
--      (payout_account_holder/payout_iban/payout_wise_email/payout_tax_id).
--   2. apply_for_affiliate(text,text,text,boolean) — başvuru artık kitle/kanal
--      bilgisi ve ŞART KABULÜ ile yapılır. (Eski sıfır argümanlı sürüm
--      KORUNUR: dağıtım sırası farklı olsa da eski istemci çalışmaya devam eder.)
--   3. affiliate_payout_summary() — artık ÖDENEBİLİR / BEKLETİLEN ayrımı yapar.
--   4. admin_mark_affiliate_paid() — 30 GÜNLÜK BEKLEME SÜRESİ uygular; yalnız
--      süresi dolmuş komisyonlar ödenir (iade ödemeden sonra gelirse para geri
--      alınamaz, bu yüzden bekleme şarttır).
--   5. record_affiliate_commission() — müşteri kodu YALNIZ Paddle ödeme
--      ekranında girmişse (kayıtta hiç kullanmamışsa) komisyonu yazan yeni yol.
--      Ayrıca `profiles.referred_by` boşsa bağlar, böylece YENİLEME ödemeleri de
--      aynı affiliate'e yazılır.
--
-- Güvenlik: para ile ilgili yazmalar yalnız service_role + SECURITY DEFINER.
-- Idempotenttir (tekrar çalıştırmak zarar vermez).
--
-- ÖNEMLİ — TS ile hizalama: 30 gün `src/lib/affiliate-payout.ts`
-- (`PAYOUT_HOLD_DAYS`) ve $75 eşiği `src/lib/affiliate.ts`
-- (`MIN_PAYOUT_CENTS`) ile AYNI olmalıdır. Değişirse üçü birlikte güncellenir.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) affiliates — başvuru detayları + şart kabulü + yapılandırılmış ödeme bilgisi
-- ---------------------------------------------------------------------------
ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS audience              text,
  ADD COLUMN IF NOT EXISTS channels              text,
  ADD COLUMN IF NOT EXISTS social_handle         text,
  ADD COLUMN IF NOT EXISTS terms_accepted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS payout_account_holder text,
  ADD COLUMN IF NOT EXISTS payout_iban           text,
  ADD COLUMN IF NOT EXISTS payout_wise_email     text,
  ADD COLUMN IF NOT EXISTS payout_tax_id         text;

COMMENT ON COLUMN public.affiliates.audience IS
  'Başvuruda beyan edilen kitle (kimlere ulaşıyor, büyüklük).';
COMMENT ON COLUMN public.affiliates.channels IS
  'Başvuruda beyan edilen kanallar (ör. "YouTube, Instagram, newsletter").';
COMMENT ON COLUMN public.affiliates.terms_accepted_at IS
  'Affiliate program şartlarının kabul edildiği an (kanıt).';
COMMENT ON COLUMN public.affiliates.payout_iban IS
  'Ödeme IBAN''ı (mod-97 doğrulaması uygulamada yapılır). Kişisel veri: RLS korumalı.';
COMMENT ON COLUMN public.affiliates.payout_wise_email IS
  'Wise hesabının e-postası (Wise ile ödeme yöntemi seçildiyse).';
COMMENT ON COLUMN public.affiliates.payout_tax_id IS
  'OPSİYONEL — vergi kimlik/mükellef numarası. Ödeme için ZORUNLU DEĞİLDİR: şirket olmayan (şahıs) affiliate boş bırakır; bazı ülkelerde banka/Wise yüksek tutarlı transferde isteyebilir, o durumda admin iletir. Eksik olması ödemeyi engellemez (bkz. src/lib/affiliate-payout.ts).';

-- ---------------------------------------------------------------------------
-- 2) apply_for_affiliate(detaylı) — kendi başvurusunu detaylarıyla oluşturur
--    Yeni arite (4 argüman) bilinçli: eski sıfır argümanlı sürüm yerinde kalır,
--    böylece kod ile migration farklı zamanlarda uygulansa bile iki taraf da
--    çalışır. PostgREST çağrıyı gönderilen argüman adlarına göre eşler.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_for_affiliate(
  _audience       text,
  _channels       text,
  _social_handle  text,
  _terms_accepted boolean
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'unauthorized';
  END IF;

  -- Şart kabulü olmadan başvuru kaydedilmez: komisyon oranı, ödeme takvimi ve
  -- iade mahsubu kurallarının kabul edildiği kanıtlanmalıdır.
  IF COALESCE(_terms_accepted, false) IS NOT TRUE THEN
    RETURN 'terms_required';
  END IF;

  INSERT INTO public.affiliates (user_id, status, commission_rate_pct, audience, channels, social_handle, terms_accepted_at)
  VALUES (
    auth.uid(), 'pending', 30,
    NULLIF(btrim(COALESCE(_audience, '')), ''),
    NULLIF(btrim(COALESCE(_channels, '')), ''),
    NULLIF(btrim(COALESCE(_social_handle, '')), ''),
    now()
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Bekleyen başvuruda detaylar güncellenebilir; ONAYLI/ASKI satırda
  -- dokunulmaz (onaydan sonra beyan değiştirmek admin kararını bozar).
  UPDATE public.affiliates
  SET audience          = COALESCE(NULLIF(btrim(COALESCE(_audience, '')), ''), audience),
      channels          = COALESCE(NULLIF(btrim(COALESCE(_channels, '')), ''), channels),
      social_handle     = COALESCE(NULLIF(btrim(COALESCE(_social_handle, '')), ''), social_handle),
      terms_accepted_at = COALESCE(terms_accepted_at, now()),
      updated_at        = now()
  WHERE user_id = auth.uid()
    AND status = 'pending';

  SELECT a.status INTO v_status
  FROM public.affiliates a
  WHERE a.user_id = auth.uid();

  RETURN COALESCE(v_status, 'pending');
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_for_affiliate(text, text, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_for_affiliate(text, text, text, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_for_affiliate(text, text, text, boolean) IS
  'Authenticated user submits their own affiliate application with audience/channels + required terms acceptance.';

-- ---------------------------------------------------------------------------
-- 2b) set_my_affiliate_payout(...) — affiliate KENDİ ödeme bilgisini gir/ güncelle
--     affiliates tablosunda authenticated kullanıcı için UPDATE politikası
--     yoktur (kişisel veri); yazma yolunun tek kapısı bu SECURITY DEFINER
--     fonksiyondur. IBAN'ın mod-97 DOĞRULAMASI uygulamada (TS) yapılır; burada
--     boşluklar temizlenir. Dönüş kodları: 'ok' | 'unauthorized' |
--     'no_application' | 'revoked' | 'invalid_method'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_affiliate_payout(
  _method         text,
  _account_holder text,
  _iban           text,
  _wise_email     text,
  _tax_id         text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'unauthorized';
  END IF;

  SELECT a.status INTO _status FROM public.affiliates a WHERE a.user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN 'no_application';
  END IF;
  -- Askıya alınmış hesap ödeme bilgisi güncelleyemez (ödeme yapılmayacak).
  IF _status = 'revoked' THEN
    RETURN 'revoked';
  END IF;

  IF lower(btrim(COALESCE(_method, ''))) NOT IN ('wise', 'iban', 'other') THEN
    RETURN 'invalid_method';
  END IF;

  UPDATE public.affiliates
  SET payout_method         = lower(btrim(_method)),
      payout_account_holder = NULLIF(btrim(COALESCE(_account_holder, '')), ''),
      payout_iban           = NULLIF(upper(regexp_replace(COALESCE(_iban, ''), '\s', '', 'g')), ''),
      payout_wise_email     = NULLIF(btrim(COALESCE(_wise_email, '')), ''),
      payout_tax_id         = NULLIF(btrim(COALESCE(_tax_id, '')), ''),
      updated_at            = now()
  WHERE user_id = auth.uid();

  RETURN 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.set_my_affiliate_payout(text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_affiliate_payout(text, text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.set_my_affiliate_payout(text, text, text, text, text) IS
  'Affiliate edits their OWN payout info (SECURITY DEFINER; no authenticated UPDATE policy on affiliates).';

-- ---------------------------------------------------------------------------
-- 3) affiliate_payout_summary() v2 — ödenebilir / beklemede ayrımı
--    Dönüş tipi değiştiği için önce düşürülür (CREATE OR REPLACE yetmez).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.affiliate_payout_summary();

CREATE OR REPLACE FUNCTION public.affiliate_payout_summary()
RETURNS TABLE (
  affiliate_id      uuid,
  pending_cents     bigint,
  pending_count     bigint,
  payable_cents     bigint,
  payable_count     bigint,
  held_cents        bigint,
  held_count        bigint,
  paid_cents        bigint,
  paid_count        bigint,
  reversed_cents    bigint,
  oldest_payable_at timestamptz,
  oldest_held_at    timestamptz,
  last_paid_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    c.affiliate_id,
    -- "pending" = ödenmemiş ve mahsup edilmemiş TÜM birikim (payable + held).
    COALESCE(SUM(c.commission_cents) FILTER (WHERE c.status = 'pending'), 0)::bigint,
    COUNT(*) FILTER (WHERE c.status = 'pending')::bigint,
    COALESCE(SUM(c.commission_cents) FILTER (
      WHERE c.status = 'pending' AND c.created_at <= now() - interval '30 days'
    ), 0)::bigint,
    COUNT(*) FILTER (
      WHERE c.status = 'pending' AND c.created_at <= now() - interval '30 days'
    )::bigint,
    COALESCE(SUM(c.commission_cents) FILTER (
      WHERE c.status = 'pending' AND c.created_at > now() - interval '30 days'
    ), 0)::bigint,
    COUNT(*) FILTER (
      WHERE c.status = 'pending' AND c.created_at > now() - interval '30 days'
    )::bigint,
    COALESCE(SUM(c.commission_cents) FILTER (WHERE c.status = 'paid'), 0)::bigint,
    COUNT(*) FILTER (WHERE c.status = 'paid')::bigint,
    COALESCE(SUM(c.commission_cents) FILTER (WHERE c.status = 'reversed'), 0)::bigint,
    MIN(c.created_at) FILTER (
      WHERE c.status = 'pending' AND c.created_at <= now() - interval '30 days'
    ),
    MIN(c.created_at) FILTER (
      WHERE c.status = 'pending' AND c.created_at > now() - interval '30 days'
    ),
    MAX(c.paid_at) FILTER (WHERE c.status = 'paid')
  FROM public.affiliate_commissions c
  GROUP BY c.affiliate_id;
$function$;

REVOKE ALL ON FUNCTION public.affiliate_payout_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_payout_summary() TO service_role;

COMMENT ON FUNCTION public.affiliate_payout_summary() IS
  'Per-affiliate commission totals split into payable (hold elapsed) / held (30-day hold) / paid / reversed.';

-- ---------------------------------------------------------------------------
-- 4) admin_mark_affiliate_paid() v2 — 30 günlük bekleme süresi
--    Yalnız süresi dolmuş (created_at <= now() - 30 gün) satırlar ödenir.
--    Hata kodları:
--      'forbidden'         → admin değil
--      'invalid_method'    → yöntem wise/iban/other değil
--      'below_threshold'   → ödenebilir birikim $75 altında
--      'hold_not_elapsed'  → toplam birikim yeterli ama süresi dolmamış
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
  _ref         text := NULLIF(btrim(COALESCE(_reference, '')), '');
  _payable     bigint;
  _pending     bigint;
  _total       bigint;
  _count       bigint;
BEGIN
  -- RBAC: yalnız admin.
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF lower(btrim(COALESCE(_method, ''))) NOT IN ('wise', 'iban', 'other') THEN
    RAISE EXCEPTION 'invalid_method';
  END IF;

  -- Ödenebilir birikim: yalnız bekleme süresi (30 gün) dolmuş satırlar.
  SELECT COALESCE(SUM(commission_cents), 0)::bigint
    INTO _payable
  FROM public.affiliate_commissions
  WHERE affiliate_id = _affiliate_id
    AND status = 'pending'
    AND created_at <= now() - interval '30 days';

  -- Toplam birikim: hata mesajını ayırt edebilmek için (bekleme mi, eşik mi?).
  SELECT COALESCE(SUM(commission_cents), 0)::bigint
    INTO _pending
  FROM public.affiliate_commissions
  WHERE affiliate_id = _affiliate_id AND status = 'pending';

  IF _payable < 7500 THEN
    IF _pending >= 7500 THEN
      RAISE EXCEPTION 'hold_not_elapsed';
    END IF;
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
      AND created_at <= now() - interval '30 days'
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
  'Admin-only: marks HOLD-ELAPSED pending commissions as paid (min $75, 30-day hold).';

-- ---------------------------------------------------------------------------
-- 5) record_affiliate_commission() — indirim kodu ile atıf (yeni yol)
--
--    NEDEN: müşteri affiliate kodunu yalnız Paddle ödeme ekranında girmiş
--    olabilir (kayıtta kullanmamış). O durumda `profiles.promo_code` ve
--    `referred_by` boştur; webhook kodu Paddle'ın indirim kaydından çözer ve
--    komisyonu bu fonksiyonla yazar.
--
--    İDEMPOTENT: `affiliate_commissions.transaction_id` UNIQUE olduğu için aynı
--    ödeme iki kez komisyon üretmez; profil üzerinden atıf zaten yazılmışsa
--    çağrı 'duplicate' döner ve hiçbir şey değişmez.
--
--    AYRICA: `profiles.referred_by` BOŞSA bağlanır — böylece YENİLEME ödemeleri
--    (indirim yalnız ilk faturada olur) de aynı affiliate'e yazılır.
--
--    NOT: buradaki ilk sürüm pencere sınırı taşımaz; 12 AYLIK komisyon
--    penceresi sonraki migration'da (20261015000000_affiliate_commission_cap.sql)
--    hem bu fonksiyon hem trigger üzerinden uygulanır.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_affiliate_commission(
  _affiliate_id    uuid,
  _user_id         uuid,
  _subscription_id text,
  _tier            text,
  _amount_cents    bigint,
  _transaction_id  text,
  _source          text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _rate   integer;
  _status text;
BEGIN
  IF _affiliate_id IS NULL OR _user_id IS NULL THEN
    RETURN 'invalid';
  END IF;

  -- Kendi kendini atıf: komisyon yazılmaz (aynı kişiye para transferi olurdu).
  IF _affiliate_id = _user_id THEN
    RETURN 'invalid';
  END IF;

  IF _transaction_id IS NULL OR btrim(_transaction_id) = '' THEN
    RETURN 'invalid';
  END IF;

  -- Anti-dust eşiği: $1 altı ödeme komisyon üretmez (webhook ile aynı kural).
  IF _amount_cents IS NULL OR _amount_cents < 100 THEN
    RETURN 'invalid';
  END IF;

  SELECT a.commission_rate_pct, a.status
    INTO _rate, _status
  FROM public.affiliates a
  WHERE a.user_id = _affiliate_id;

  IF NOT FOUND OR _status IS DISTINCT FROM 'verified' OR COALESCE(_rate, 0) <= 0 THEN
    RETURN 'not_affiliate';
  END IF;

  INSERT INTO public.affiliate_commissions (
    affiliate_id, referred_user_id, subscription_id, tier,
    gross_amount_cents, commission_rate_pct, commission_cents, transaction_id, status
  ) VALUES (
    _affiliate_id, _user_id, _subscription_id, _tier,
    _amount_cents::integer, _rate,
    GREATEST(1, round(_amount_cents * _rate / 100.0))::integer,
    _transaction_id, 'pending'
  )
  ON CONFLICT (transaction_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  -- Kalıcı atıf: yenileme ödemeleri de aynı affiliate'e yazılsın.
  UPDATE public.profiles
  SET referred_by = _affiliate_id
  WHERE id = _user_id
    AND referred_by IS NULL;

  RETURN 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.record_affiliate_commission(uuid, uuid, text, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_affiliate_commission(uuid, uuid, text, text, bigint, text, text)
  TO service_role;

COMMENT ON FUNCTION public.record_affiliate_commission(uuid, uuid, text, text, bigint, text, text) IS
  'Writes a recurring commission when attribution comes from the Paddle discount code instead of the signup code (idempotent per transaction; links profiles.referred_by when empty).';
