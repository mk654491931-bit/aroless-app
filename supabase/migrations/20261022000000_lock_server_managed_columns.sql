-- ============================================================================
-- GÜVENLİK: SUNUCU-YÖNETİMLİ SÜTUNLAR İSTEMCİYE KAPATILIR
--
-- BULGU (kritik): `profiles` tablosunda `authenticated` rolüne TABLO düzeyinde
-- UPDATE verilmiş ve RLS yalnızca SATIRI sınırlıyordu (`auth.uid() = id`).
-- Sütun kısıtı olmadığı için herhangi bir oturum açmış kullanıcı Supabase REST
-- API'sine doğrudan:
--
--     PATCH /rest/v1/profiles?id=eq.<kendi-id>
--     { "credits": 999999, "finder_credits": 999999 }
--
-- yazabiliyordu. Yani jeton/paywall kapılarının tamamı (chargeAiCredits,
-- PLAN_LIMIT, NO_CREDITS) istemci tarafından atlatılabiliyordu: ücretli AI
-- özellikleri sınırsız bedava kullanılabilirdi.
--
-- Abonelik sütunları daha önce kısmen kapatılmıştı ama `credits`,
-- `finder_credits`, `sim_credits`, `credits_spent` ve kota damgaları açık
-- kalmıştı ("iade yolları kullanıcı istemcisiyle yazıyor" gerekçesiyle).
-- İade yolları artık sunucu tarafında (`refundCredit` → service_role) çalışıyor,
-- bu yüzden bu sütunlara istemci erişimine ihtiyaç YOK.
--
-- İKİ KATMAN:
--   1. Sütun düzeyinde REVOKE (PostgREST artık bu sütunları yazamaz).
--   2. BEFORE UPDATE trigger: yetki yanlışlıkla geri verilse bile, service_role
--      veya SECURITY DEFINER (postgres) dışındaki roller bu sütunları
--      değiştiremez → fail-closed savunma derinliği.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) YETKİ MODELİ: tablo düzeyi UPDATE kaldırılır, YALNIZ güvenli sütunlar
--    istemciye açılır.
--
--    ÖNEMLİ POSTGRES KURALI: tablo düzeyinde UPDATE yetkisi varken sütun
--    düzeyinde `REVOKE UPDATE (kolon)` HİÇBİR ŞEY yapmaz — tablo düzeyi yetki
--    tüm sütunları kapsamaya devam eder. Bu yüzden önceki migration'lardaki
--    sütun bazlı REVOKE'lar (abonelik/atıf sütunları) fiilen etkisizdi. Tek
--    güvenilir yol: tablo düzeyi UPDATE'i kaldırıp yalnız güvenli sütunları
--    yeniden GRANT etmek.
--
--    İstemcinin gerçekten yazdığı tek alanlar: dil, para birimi, bildirim
--    tercihi ve tanıtım (onboarding) bayrağı (bkz. analysis.functions.ts →
--    updateProfilePrefs). Diğer HER ŞEY sunucuya aittir.
-- ---------------------------------------------------------------------------
-- ÖNCE TÜMÜYLE KAPAT, SONRA GEREKLİYİ VER (fail-closed sıra).
-- `REVOKE ALL` yalnız UPDATE/INSERT'i değil, varsayılan yetkilerle gelebilecek
-- DELETE/TRUNCATE/REFERENCES/TRIGGER yetkilerini de kaldırır (TRUNCATE, RLS'i
-- tamamen atlar; PostgREST üzerinden erişilemese de savunma derinliğidir).
REVOKE ALL ON public.profiles FROM authenticated, anon;
GRANT SELECT ON public.profiles TO authenticated;

DO $$
BEGIN
  EXECUTE 'GRANT UPDATE (language, currency, notifications_enabled, onboarding_completed)
           ON public.profiles TO authenticated';
EXCEPTION WHEN undefined_column THEN
  -- Sütun adı şemada farklıysa hiçbir yazma yetkisi verilmez (fail-closed).
  NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Trigger: rol tabanlı son kapı
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_guard_server_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- service_role (sunucu) ve SECURITY DEFINER sahibi (postgres) serbest.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.credits IS DISTINCT FROM OLD.credits
     OR NEW.finder_credits IS DISTINCT FROM OLD.finder_credits
     OR NEW.sim_credits IS DISTINCT FROM OLD.sim_credits
     OR NEW.credits_spent IS DISTINCT FROM OLD.credits_spent
     OR NEW.credits_reset_at IS DISTINCT FROM OLD.credits_reset_at
     OR NEW.welcome_credits_granted_at IS DISTINCT FROM OLD.welcome_credits_granted_at
     OR NEW.admin_credits_granted IS DISTINCT FROM OLD.admin_credits_granted
     OR NEW.referred_by IS DISTINCT FROM OLD.referred_by
     OR NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.current_period_start IS DISTINCT FROM OLD.current_period_start
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     OR NEW.next_billed_at IS DISTINCT FROM OLD.next_billed_at
  THEN
    RAISE EXCEPTION 'server_managed_profile_columns'
      USING ERRCODE = '42501',
            HINT = 'Bakiye, kota ve abonelik alanları yalnız sunucu tarafından yazılır.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_guard_server_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_server_columns ON public.profiles;
CREATE TRIGGER profiles_guard_server_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_server_columns();

COMMENT ON FUNCTION public.profiles_guard_server_columns() IS
  'Blocks client-side writes to credit/quota/entitlement columns on profiles (defense in depth on top of column REVOKEs).';

-- ---------------------------------------------------------------------------
-- 3) Arama işleri: kullanıcı kendi işinin SONUCUNU/DURUMUNU yazamaz
--
--    `searches_update_own` politikası, istemcinin `result`/`status` sütunlarını
--    doğrudan yazmasına izin veriyordu (sahte "completed" + uydurma ürün).
--    İşleri yalnız sunucu (service_role) günceller; istemci sadece okur.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "searches_update_own" ON public.searches;
DROP POLICY IF EXISTS "searches_insert_own" ON public.searches;

-- İstemci bu tabloya hiç yazmaz (iş kaydını sunucu açar); yazma yetkisi de
-- gereksiz. Okuma kendi satırıyla sınırlı kalır.
REVOKE INSERT, UPDATE, DELETE ON public.searches FROM authenticated, anon;
GRANT SELECT ON public.searches TO authenticated;

-- ---------------------------------------------------------------------------
-- 3b) PROMOSYON KODLARI: toplu listeleme kapatılır
--
--     "Authenticated view active codes" politikası, oturum açmış HERKESE tüm
--     aktif kodları (ve kimin affiliate'i olduğunu) listeleme izni veriyordu.
--     Bir rakip, kodları toplayıp influencer atıflarını haritalayabilir ya da
--     kullanılmayan kodları hedefli deneyebilirdi. Kod doğrulama/sahiplik
--     sunucu fonksiyonlarından (service_role) yürür; istemciye toplu okuma
--     gerekmez.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated view active codes" ON public.promo_codes;

-- ---------------------------------------------------------------------------
-- 3c) PostgREST şema önbelleğini tazele
--
--     Yetki değişiklikleri PostgREST'in önbelleğinde gecikebilir; tazelenmezse
--     kullanıcı bir süre ESKİ (geniş) yetkiyle devam eder. Migration sonunda
--     açıkça yenilenir.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4) NOT — e-posta (email) ve abonelik alanları
--
--    Bölüm 1 tablo düzeyi UPDATE'i kaldırdığı ve yalnız dört güvenli sütunu
--    geri verdiği için `email`, `promo_code`, `public_id`, `user_id_number`,
--    abonelik ve kota sütunlarının TAMAMI istemciye kapalıdır. `email` yalnız
--    auth trigger'ı + service_role tarafından yazılır; bu, Paddle aboneliğini
--    başka bir müşterinin e-postası üzerinden sahiplenme (reconcile) yolunu da
--    kapatır.
-- ---------------------------------------------------------------------------
