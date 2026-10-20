-- KULLANICI KAPSAMLI JETON İŞLEMLERİ (servis anahtarı OLMADAN).
--
-- ÖLÇÜLEN SORUN: aylık kullanım defteri (`credit_usage_log`) ve admin günlük
-- kotası (`refresh_admin_daily_credits`) yalnız `service_role` ile yazılıyordu.
-- Servis anahtarı tanımlı değilse:
--   • jeton DÜŞÜYOR ama deftere satır yazılamıyor → "bu ay" sayaçları hep 0,
--   • admin bakiyesi 250'ye tazelenemiyor → admin 0 jetonla `NO_CREDITS` alıyor.
-- Yani jeton sayıları aboneliğe göre işlemiyordu.
--
-- ÇÖZÜM: iki iş için `auth.uid()` üzerinde çalışan SECURITY DEFINER fonksiyon.
-- İkisi de YALNIZ çağıranın kendi satırına dokunur; başka kullanıcıya jeton
-- yazamaz, bakiye artıramaz.
--
-- GÜVENLİK NOTU (neden bu iki iş, neden iade değil):
--   • `log_ai_usage` SADECE POZİTİF tüketim yazar. Negatif (iade) satır
--     yazılabilseydi kullanıcı aylık limitini kendi lehine düşürebilirdi;
--     bu yüzden iade yolu service_role'e kapalı kalıyor.
--   • En kötü kötüye kullanım, kullanıcının KENDİ sayacını şişirmesi
--     (kendi özelliklerini erken kilitlemesi) olur; başkasına etkisi yoktur.
--   • `claim_admin_daily_credits` yalnız rolü/tanımı admin olan hesapta çalışır
--     ve günde BİR kez uygulanır (ledger `ref_key` tekilleştirir).

-- ---------------------------------------------------------------------------
-- 1) KULLANIM DEFTERİ — kullanıcı kendi tüketimini yazar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_ai_usage(_tool text, _credits integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  today_count integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  -- YALNIZ TÜKETİM. `<= 0` sessizce yok sayılır (iade yolu buradan geçmez).
  IF _credits IS NULL OR _credits <= 0 THEN RETURN; END IF;

  -- SATIR SELLEME KORUMASI: günde en fazla 200 satır. Aylık okuma zaten
  -- MAX_ROWS ile sınırlı; bu kontrol onu anlamsız kılacak şişirmeyi engeller.
  SELECT count(*) INTO today_count
  FROM public.credit_usage_log
  WHERE user_id = uid AND created_at >= date_trunc('day', now());
  IF today_count >= 200 THEN RETURN; END IF;

  INSERT INTO public.credit_usage_log (user_id, tool, credits, success)
  VALUES (
    uid,
    left(coalesce(nullif(btrim(_tool), ''), 'unknown'), 80),
    least(_credits, 500),
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_ai_usage(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_ai_usage(text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) ADMIN GÜNLÜK 250 — kullanıcı kendi hesabı için talep eder.
-- ---------------------------------------------------------------------------
-- `refresh_admin_daily_credits()` tüm adminleri gezer ve service_role ister;
-- bu sürüm yalnız ÇAĞIRANIN satırını tazeler. Hedefin ÜSTÜNDEKİ bakiye
-- kırpılmaz (`greatest`), böylece kazanılmış jetonlar silinmez.
CREATE OR REPLACE FUNCTION public.claim_admin_daily_credits()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  today date := (now() AT TIME ZONE 'utc')::date;
  ledger_id bigint;
  is_admin boolean := false;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;

  -- 1) Rol kaydı (asıl kaynak).
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = uid AND ur.role = 'admin'
  ) INTO is_admin;

  -- 2) Rol yoksa e-posta tabanlı tanım (trigger'ların dayandığı kaynak).
  IF NOT is_admin THEN
    SELECT coalesce(public.is_designated_admin(p.email), false)
    INTO is_admin
    FROM public.profiles p
    WHERE p.id = uid;
  END IF;

  IF NOT coalesce(is_admin, false) THEN RETURN false; END IF;

  -- Bakiye zaten hedefin üstündeyse hiçbir şey yapılmaz: ledger'a "+250"
  -- yazıp bakiyeyi değiştirmemek defteri yalancı yapardı.
  IF (SELECT coalesce(max(p.credits), 0) FROM public.profiles p WHERE p.id = uid) >= 250 THEN
    RETURN false;
  END IF;

  -- Günde bir kez: aynı gün ikinci çağrı ledger'da çakışır ve hiçbir şey yapmaz.
  INSERT INTO public.credit_ledger (user_id, delta, reason, ref_key, metadata)
  VALUES (
    uid,
    250,
    'admin_daily_refresh',
    'admin-daily:' || uid::text || ':' || today::text,
    jsonb_build_object('note', 'günlük admin kotası (kullanıcı kapsamlı)')
  )
  ON CONFLICT (ref_key) WHERE ref_key IS NOT NULL DO NOTHING
  RETURNING id INTO ledger_id;

  IF ledger_id IS NULL THEN RETURN false; END IF;

  UPDATE public.profiles
  SET credits = greatest(credits, 250),
      credits_reset_at = today,
      updated_at = now()
  WHERE id = uid;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_admin_daily_credits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_admin_daily_credits() TO authenticated;
