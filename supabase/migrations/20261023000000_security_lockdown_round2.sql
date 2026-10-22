-- ============================================================================
-- GÜVENLİK — İKİNCİ TUR: JETON İADESİ, PROMOSYON SAYACI, ATIF TABLOSU
--
-- Bu dosya üç ayrı bulguyu kapatır. Üçü de "istemcinin doğrudan PostgREST'e
-- konuşabildiği" varsayımına dayanır: uygulama kodu doğru olsa bile, yetki
-- verilmiş bir tablo/fonksiyon arayüzü ATLAYARAK çağrılabilir.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) KRİTİK — KULLANICI KENDİ JETONUNU İADE ETTİREBİLİYORDU
--
--    `refund_product_finder_credit_for_job(uuid)` fonksiyonu `authenticated`
--    rolüne açıktı. Uygulamada bu fonksiyonu ÇAĞIRAN hiçbir kod yok (iade
--    yolları `refund_credit_once` + `mark_discovery_credit_refunded` üzerinden
--    service_role ile yürür). Yani herhangi bir kullanıcı:
--
--        1. Ürün Bulucu araması başlatır  → 1 jeton düşer,
--        2. `POST /rest/v1/rpc/refund_product_finder_credit_for_job`
--           { "_job_id": "<kendi-arama-id>" } çağırır → jeton GERİ gelir,
--        3. arama normal şekilde TAMAMLANIR (iş durdurulmaz).
--
--    Sonuç: her arama bedava. Bu, jeton ekonomisinin tamamını çökertir.
--
--    İKİ KATMAN:
--      • EXECUTE yetkisi `authenticated`/`anon`'dan alınır (tek gerçek kapı).
--      • Fonksiyon gövdesi, yetki yanlışlıkla geri verilse bile yalnız
--        `status = 'failed'` olan bir iş için iade yapar (fail-closed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_product_finder_credit_for_job(_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source text;
  job_status text;
  already_charged boolean;
  already_refunded boolean;
  remaining integer;
BEGIN
  SELECT credit_source, credit_charged, credit_refunded, status
    INTO source, already_charged, already_refunded, job_status
  FROM public.searches
  WHERE id = _job_id AND user_id = auth.uid()
  FOR UPDATE;

  -- SAHİPLİK + DURUM: yalnız kendi işi, yalnız BAŞARISIZ iş, yalnız bir kez.
  -- Koşullardan biri tutmazsa iade YAPILMAZ; mevcut bakiye döner (eski
  -- davranışla uyumlu, ama artık parasal sonucu yok).
  IF NOT FOUND
     OR NOT COALESCE(already_charged, false)
     OR COALESCE(already_refunded, false)
     OR job_status IS DISTINCT FROM 'failed' THEN
    SELECT finder_credits INTO remaining FROM public.profiles WHERE id = auth.uid();
    RETURN COALESCE(remaining, 0);
  END IF;

  IF source = 'finder' THEN
    UPDATE public.profiles
    SET finder_credits = finder_credits + 1,
        credits_spent = GREATEST(0, credits_spent - 1),
        updated_at = now()
    WHERE id = auth.uid()
    RETURNING finder_credits INTO remaining;
  ELSE
    UPDATE public.profiles
    SET credits = credits + 1,
        credits_spent = GREATEST(0, credits_spent - 1),
        updated_at = now()
    WHERE id = auth.uid()
    RETURNING credits INTO remaining;
  END IF;

  UPDATE public.searches
  SET credit_refunded = true,
      updated_at = now()
  WHERE id = _job_id AND user_id = auth.uid();

  RETURN COALESCE(remaining, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.refund_product_finder_credit_for_job(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_product_finder_credit_for_job(uuid)
  TO service_role;

COMMENT ON FUNCTION public.refund_product_finder_credit_for_job(uuid) IS
  'Sunucu tarafı iade (service_role). Yalnız çağıranın BAŞARISIZ işi ve yalnız bir kez; istemciye kapalıdır.';

-- ---------------------------------------------------------------------------
-- 2) ORTA — PROMOSYON KODU SAYACI (yarış → aşırı kullanım)
--
--    `promo_codes.times_redeemed` uygulamada OKU-DEĞİŞTİR-YAZ ile artırılıyordu
--    (`times_redeemed = okunan + 1`). Eşzamanlı iki sahiplenme aynı değeri
--    okuyup aynı değeri yazdığı için sayaç az kalıyor ve `max_redemptions`
--    sınırı AŞILABİLİYORDU (kontrollü kampanya = kontrolsüz indirim).
--
--    ÇÖZÜM: artırma tek atomik UPDATE'e taşınır; sınır aynı ifadenin içinde
--    kontrol edilir. `false` dönerse kod tükenmiştir ve çağıran sahiplenmeyi
--    REDDEDER. Fonksiyon yalnız service_role'e açıktır.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_promo_redemption(_code_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE public.promo_codes
  SET times_redeemed = COALESCE(times_redeemed, 0) + 1
  WHERE id = _code_id
    AND active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND (max_redemptions IS NULL OR COALESCE(times_redeemed, 0) < max_redemptions);
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_promo_redemption(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_promo_redemption(uuid) TO service_role;

COMMENT ON FUNCTION public.increment_promo_redemption(uuid) IS
  'Atomically reserves one redemption of a promo code; returns false when inactive, expired or exhausted.';

-- Yazma hatası olursa ayrılan kontenjan geri bırakılır (sayaç şişmesin).
CREATE OR REPLACE FUNCTION public.release_promo_redemption(_code_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.promo_codes
  SET times_redeemed = GREATEST(0, COALESCE(times_redeemed, 0) - 1)
  WHERE id = _code_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_promo_redemption(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_promo_redemption(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) ATIF TABLOSU: İSTEMCİNİN KENDİ SATIRINI YAZMASI KAPATILIR
--
--    `promo_redemptions` üzerinde `authenticated` rolüne INSERT verilmişti
--    ("users record own redemption"). Bu satırlar admin/affiliate raporlarını
--    besler; bir kullanıcı istediği koda kendini yazarak atıf verisini
--    kirletebiliyordu. Yazma yollarının TAMAMI sunucuda (service_role):
--    kayıt (`signup.functions.ts`), kod sahiplenme (`promo.functions.ts`) ve
--    Paddle webhook'u. İstemcinin bu tabloya ihtiyacı yoktur.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "users_record_own_redemption" ON public.promo_redemptions;
REVOKE INSERT, UPDATE, DELETE ON public.promo_redemptions FROM authenticated, anon;
GRANT SELECT ON public.promo_redemptions TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) PostgREST şema önbelleğini tazele
--
--    Fonksiyon imzaları ve yetkiler değişti; önbellek tazelenmezse istemci bir
--    süre ESKİ yetkiyle (açık iade fonksiyonuyla) konuşmaya devam edebilir.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
