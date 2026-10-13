-- ============================================================================
-- AFFILIATE KOMİSYON PENCERESİ — bir müşteri için komisyon EN FAZLA 12 AY.
--
-- ÜRÜN KARARI: affiliate, getirdiği müşteri ücretli kaldığı SÜRECE aylık %30
-- komisyon kazanır — ama en fazla 12 ay. Müşteri 4. ayda bırakırsa komisyon
-- yalnız 4 ay için yazılmış olur; 12 ay dolduğunda YENİ komisyon doğmaz.
--
-- NEDEN: süresiz yinelenen komisyon tek bir müşteri için sınırsız ve
-- öngörülemeyen bir yükümlülük yaratır. 12 ay, CAC mantığıyla uyumlu ve
-- affiliate'e önceden açıklanabilir bir taahhüttür.
--
-- NEDEN TRIGGER (fonksiyon gövdesini kopyalamak yerine):
--   `process_paddle_event()` (20260907000000/20260908000000) ve
--   `record_affiliate_commission()` (20261014000000) komisyonu İKİ AYRI yoldan
--   yazar. Sınırı bu iki fonksiyonun içine gömmek, BİRİNCİSİNİN ~200 satırlık
--   gövdesini her sınır değişikliğinde kopyalamak demekti ve iki yolun
--   ayrışmasına açıktı. BEFORE INSERT trigger sınırı TEK yerde tutar ve
--   komisyon yazan GELECEKTEKİ yolları da otomatik kapsar.
--
-- SAYI TEK KAYNAK: `_max_months integer := 12` ile `src/lib/affiliate.ts`
--   (`COMMISSION_MAX_MONTHS`) BİRLİKTE değişir; `supabase-migrations.test.ts`
--   ayrışmayı yakalar.
--
-- MAHSUP EDİLEN AY PENCEREYİ TÜKETMEZ: yalnız `status <> 'reversed'` satırlar
--   sayılır. İade edilen bir ay gelir üretmemiştir; affiliate'in 12 ayını
--   harcamak haksız olurdu.
--
-- Idempotenttir (tekrar çalıştırmak zarar vermez).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Sınır bekçisi — pencere dolduğunda komisyon satırını YAZDIRMAZ.
--    BEFORE INSERT + RETURN NULL = satır eklenmez (hata değil, sessiz atlama
--    yerine log'a WARNING düşer). İade ile düşülen ay yeniden yazılabilir.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_affiliate_commission_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- 12 = src/lib/affiliate.ts COMMISSION_MAX_MONTHS (ikisi BİRLİKTE değişir).
  _max_months integer := 12;
  _used       integer;
BEGIN
  -- Müşteri eşleşmesi olmadan pencere hesaplanamaz. Bu yol zaten komisyon
  -- yazmaz (her iki üretim yolu da referred_user_id taşır); satır engellenmez.
  IF NEW.referred_user_id IS NULL OR NEW.affiliate_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::integer
    INTO _used
  FROM public.affiliate_commissions c
  WHERE c.affiliate_id = NEW.affiliate_id
    AND c.referred_user_id = NEW.referred_user_id
    AND c.status <> 'reversed';

  IF _used >= _max_months THEN
    RAISE WARNING
      '[affiliate] komisyon penceresi doldu (% ay): affiliate % · müşteri %',
      _max_months, NEW.affiliate_id, NEW.referred_user_id;
    RETURN NULL; -- bu satır yazılmaz
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_affiliate_commission_cap() IS
  'BEFORE INSERT bekçisi: bir müşteri için 12 aylık komisyon penceresi dolduysa yeni komisyon satırı yazılmaz.';

-- Trigger adı sabit olduğu için önce düşürülür; yeniden çalıştırma güvenli.
DROP TRIGGER IF EXISTS enforce_affiliate_commission_cap ON public.affiliate_commissions;
CREATE TRIGGER enforce_affiliate_commission_cap
  BEFORE INSERT ON public.affiliate_commissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_affiliate_commission_cap();

-- ---------------------------------------------------------------------------
-- 2) record_affiliate_commission() — pencere dolduğunda 'cap_reached' döner
--    (tetikleyicinin sessiz atlaması webhook logunda 'duplicate' gibi
--    görünmesin: mükerrer ödeme ile PENCERE DOLMASI ayrı iki durumdur).
--    Gövde, 20261014000000 ile aynıdır + yalnız pencere kontrolü eklenmiştir.
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
  -- 12 = src/lib/affiliate.ts COMMISSION_MAX_MONTHS (ikisi BİRLİKTE değişir).
  _max_months integer := 12;
  _used       integer;
  _rate       integer;
  _status     text;
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

  -- 12 AYLIK PENCERE: mahsup edilmiş aylar sayılmaz (o ay gelir üretmedi).
  SELECT COUNT(*)::integer
    INTO _used
  FROM public.affiliate_commissions c
  WHERE c.affiliate_id = _affiliate_id
    AND c.referred_user_id = _user_id
    AND c.status <> 'reversed';

  IF _used >= _max_months THEN
    RETURN 'cap_reached';
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
    -- Satır yazılamadı: ya aynı ödeme ikinci kez geldi ya da trigger pencereyi
    -- kapattı (eşzamanlı iki ödeme arasında pencere dolmuş olabilir).
    SELECT COUNT(*)::integer
      INTO _used
    FROM public.affiliate_commissions c
    WHERE c.affiliate_id = _affiliate_id
      AND c.referred_user_id = _user_id
      AND c.status <> 'reversed';

    IF _used >= _max_months THEN
      RETURN 'cap_reached';
    END IF;
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
  'Paddle indirim kodundan gelen atıfta komisyon yazar (idempotent). 12 aylık pencere dolduysa ''cap_reached'' döner.';
