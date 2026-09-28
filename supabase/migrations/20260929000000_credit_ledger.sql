-- KREDİ DEFTERİ + ÇİFT İADE KORUMASI.
--
-- SORUN: kredi artıran yollar (`increment_profile_credits`) koşulsuz
-- `credits = credits + _amount` yapıyordu. Tek bir anahtar (ref_key) olmadığı
-- için aynı iade/bonus iki kez çalışırsa kredi iki kez artıyor ve "sistem
-- kendi kendine kredi tanımlıyor" belirtisi çıkıyor. Artan miktarın nereden
-- geldiği de kalıcı bir iz olmadığı için teşhis imkânsızdı.
--
-- ÇÖZÜM (iki parça):
--   1. `credit_ledger`: HER kredi harekesi için değişmez (append-only) kayıt.
--      "Kime, ne kadar, hangi sebeple" sorusu artık yanıtlanabilir.
--   2. `refund_credit_once`: aynı iade anahtarı ikinci kez gelirse hiçbir şey
--      yapmaz ve `false` döner. Uygulama katmanı da yalnız `true` aldığında
--      ikinci kez denemez.
--
-- Geriye dönük uyum: `increment_profile_credits` imzası DEĞİŞMEDİ; artık
-- defter satırı da yazıyor. Yeni migration uygulanmadan önce çalışan kurulumlar
-- etkilenmez.

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta       integer NOT NULL,            -- pozitif: kazanç, negatif: harcama/iade
  reason      text    NOT NULL,            -- 'signup' | 'paddle' | 'referral' | 'refund' | ...
  ref_key     text,                        -- aynı işlemi tekilleştiren anahtar
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Aynı ref_key ile İKİ KAYIT yazılmasını veritabanı seviyesinde engeller.
-- NULL ref_key serbesttir: köksüz artışlar (ilk kurulum) yazılabilir kalsın.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_ref_key_uniq
  ON public.credit_ledger (ref_key)
  WHERE ref_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS credit_ledger_user_idx
  ON public.credit_ledger (user_id, created_at DESC);

REVOKE ALL ON TABLE public.credit_ledger FROM anon, authenticated;
GRANT SELECT ON TABLE public.credit_ledger TO service_role;

-- Tek seferlik iade: ikinci çağrı `false` döner ve kredi ARTIRMAZ.
CREATE OR REPLACE FUNCTION public.refund_credit_once(
  _profile_id uuid,
  _amount integer,
  _reason text DEFAULT 'refund',
  _ref_key text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id bigint;
BEGIN
  IF _amount <= 0 THEN RETURN false; END IF;

  IF _ref_key IS NOT NULL THEN
    -- Anahtar daha önce kullanıldıysa BURADA bitiyoruz: kredi hiç artmaz.
    INSERT INTO public.credit_ledger (user_id, delta, reason, ref_key)
    VALUES (_profile_id, _amount, _reason, _ref_key)
    ON CONFLICT (ref_key) WHERE ref_key IS NOT NULL DO NOTHING
    RETURNING id INTO inserted_id;

    IF inserted_id IS NULL THEN RETURN false; END IF;
  ELSE
    INSERT INTO public.credit_ledger (user_id, delta, reason)
    VALUES (_profile_id, _amount, _reason);
  END IF;

  UPDATE public.profiles
  SET credits = credits + _amount, updated_at = now()
  WHERE id = _profile_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_credit_once(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credit_once(uuid, integer, text, text) TO service_role;

-- Kredi artıran mevcut fonksiyon: imza aynı, ama artık iz bırakıyor.
CREATE OR REPLACE FUNCTION public.increment_profile_credits(_profile_id uuid, _amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _amount = 0 THEN RETURN; END IF;
  INSERT INTO public.credit_ledger (user_id, delta, reason)
  VALUES (_profile_id, _amount, 'increment_profile_credits');
  UPDATE public.profiles
  SET credits = credits + _amount
  WHERE id = _profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_profile_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_profile_credits(uuid, integer) TO service_role;

-- Admin günlük tazelemesi de iz bırakır: "krediler neden doldu?" sorusunun
-- cevabı artık defterde. (Davranış değişmedi: günde bir kez 250 atanır.)
CREATE OR REPLACE FUNCTION public.refresh_admin_daily_credits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
  ledger_id bigint;
BEGIN
  FOR target IN
    SELECT p.id
    FROM public.profiles p
    WHERE EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role = 'admin'
    )
    AND (p.credits_reset_at IS NULL OR p.credits_reset_at < current_date)
  LOOP
    INSERT INTO public.credit_ledger (user_id, delta, reason, ref_key, metadata)
    VALUES (
      target,
      250,
      'admin_daily_refresh',
      'admin-daily:' || target::text || ':' || current_date::text,
      jsonb_build_object('note', 'günlük admin kotası')
    )
    ON CONFLICT (ref_key) WHERE ref_key IS NOT NULL DO NOTHING
    RETURNING id INTO ledger_id;

    -- Kullanıcı bugün kullandıysa defter kaydı çakışır ve kredi SIFIRLANMAZ.
    -- (Aksi hâlde gün içinde kazanılan krediler bir sonraki çağrıda ezilirdi.)
    IF ledger_id IS NULL THEN CONTINUE; END IF;

    UPDATE public.profiles
    SET credits = 250, credits_reset_at = current_date, updated_at = now()
    WHERE id = target;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_admin_daily_credits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_admin_daily_credits() TO service_role;
