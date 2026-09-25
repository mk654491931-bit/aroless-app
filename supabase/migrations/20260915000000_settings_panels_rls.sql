-- ============================================================================
-- Ayarlar panelleri: affiliate başvurusu + admin destek talebi işlemleri
--
-- Sorun: "Başvuru yap" ve admin'in destek talebine cevap vermesi yalnızca
-- service_role anahtarına bağlıydı. Anahtar yoksa (ya da geç gelirse) kullanıcı
-- boş bir panel, admin ise "Henüz destek talebi yok" görüntüsü alıyordu —
-- yani gönderilen talepler kaybolmuş gibi görünüyordu.
--
-- Çözüm (güvenlik modeli korunarak):
--   1. public.apply_for_affiliate() — SECURITY DEFINER. Kullanıcı YALNIZCA
--      kendi başvuru satırını 'pending' durumla oluşturur; komisyon oranı ve
--      durum sunucuda sabitlenir, istemciden gelen değerler yok sayılır.
--      Doğrulama/askıya alma hâlâ sadece verify_affiliate() (admin-only) ile
--      yapılır; kullanıcı kendini 'verified' yapamaz.
--   2. support_tickets UPDATE grant'ı: "Admins manage tickets" politikası
--      FOR ALL idi ama tabloda UPDATE grant'ı yoktu; bu yüzden admin notu/
--      durum güncellemesi yalnızca service_role ile mümkündü. GRANT ekleniyor;
--      politika zaten has_role() ile yalnızca admin'e izin veriyor.
--
-- Güvenlik: referred_by / komisyon defteri gibi para ile ilgili yazmalar
-- service_role'da kalır; burada yalnızca kendi satırı olan veriler açılıyor.
-- Idempotenttir. 20260908000000_affiliate_commissions.sql'den sonra çalışır.
-- ============================================================================

-- ------------------------------------------------------------------ 
-- 1) apply_for_affiliate() — kullanıcı kendi başvurusunu oluşturur
-- ------------------------------------------------------------------ 
CREATE OR REPLACE FUNCTION public.apply_for_affiliate()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'unauthorized';
  END IF;

  -- Idempotent: başvuru zaten varsa durumu değiştirmez (yalnızca okur).
  INSERT INTO public.affiliates (user_id, status, commission_rate_pct)
  VALUES (auth.uid(), 'pending', 30)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT a.status INTO v_status
  FROM public.affiliates a
  WHERE a.user_id = auth.uid();

  RETURN COALESCE(v_status, 'pending');
END;
$$;

REVOKE ALL ON FUNCTION public.apply_for_affiliate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_for_affiliate() TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_for_affiliate() IS
  'Authenticated user submits (or re-reads) their own affiliate application. Status is always pending; only admins can verify via verify_affiliate().';

-- ------------------------------------------------------------------ 
-- 2) support_tickets UPDATE — admin notu/durum değişimi RLS üzerinden
-- ------------------------------------------------------------------ 
-- Politika zaten mevcut ve yalnızca has_role(auth.uid(),'admin') olanlara izin
-- veriyor; eksik olan tek şey tabloda UPDATE yetkisi.
GRANT UPDATE ON public.support_tickets TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.support_tickets') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'support_tickets'
         AND policyname = 'Admins manage tickets'
     )
  THEN
    EXECUTE
      'CREATE POLICY "Admins manage tickets" ON public.support_tickets
       FOR ALL TO authenticated
       USING (public.has_role(auth.uid(), ''admin''))
       WITH CHECK (public.has_role(auth.uid(), ''admin''))';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Kullanıcı kendi talebini görebilsin (SELECT grant'i zaten vardı, politika da).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'support_tickets'
      AND policyname = 'Users view own tickets'
  ) THEN
    EXECUTE
      'CREATE POLICY "Users view own tickets" ON public.support_tickets
       FOR SELECT TO authenticated USING (auth.uid() = user_id)';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
