-- Onarım migration'ı: `public.bump_rate_limit` RPC'sini garantiler.
--
-- BELİRTİ (ölçülen canlı hata):
--   [rate-limit] rpc failed: Could not find the function
--   public.bump_rate_limit(_bucket, _limit, _window_seconds) in the schema cache
--
-- Sebep: migration `20260824013156_…` korumasız bir `CREATE POLICY` ile
-- başlıyordu. Tablo ve policy daha önce oluşmuşsa ikinci çalıştırma "policy
-- already exists" hatasıyla DURUR ve dosyanın devamı — fonksiyonun kendisi —
-- hiç uygulanmaz. Sonuç: tablo var, RPC yok. İstek sınırı her istekte hata
-- üretiyor, Postgres yeni şema önbelleğini yükleyene kadar da "could not find
-- function" devam eder.
--
-- Bu dosya kasıtlı olarak TAMAMEN YENİDEN ÇALIŞTIRILABİLİR:
--   * tablo  → CREATE TABLE IF NOT EXISTS
--   * policy → DROP POLICY IF EXISTS + CREATE POLICY
--   * fonksiyon → CREATE OR REPLACE (zaten idempotent)
--   * yetkiler → REVOKE + GRANT (tekrar çalıştırılabilir)
-- Uygulama sırası fark etmez: bu migration ne bir tabloyu ne bir veriyi
-- değiştirir, yalnızca eksik olanı oluşturur. Geri alınabilir değildir ama
-- geri alınması da gerekmez (yalnızca bir sayaç tablosu ve bir sayaç fonksiyonu).

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, window_start)
);

GRANT ALL ON public.api_rate_limits TO service_role;
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_rate_limits" ON public.api_rate_limits;
CREATE POLICY "admins_read_rate_limits" ON public.api_rate_limits
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.api_rate_limits TO authenticated;

CREATE OR REPLACE FUNCTION public.bump_rate_limit(_bucket text, _limit integer, _window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / GREATEST(_window_seconds, 1)) * GREATEST(_window_seconds, 1));
  c integer;
BEGIN
  INSERT INTO public.api_rate_limits (bucket, window_start, count)
  VALUES (_bucket, w, 1)
  ON CONFLICT (bucket, window_start)
  DO UPDATE SET count = public.api_rate_limits.count + 1
  RETURNING count INTO c;

  DELETE FROM public.api_rate_limits WHERE window_start < now() - interval '1 day';

  RETURN c <= _limit;
END; $$;

REVOKE ALL ON FUNCTION public.bump_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_rate_limit(text, integer, integer) TO service_role;

-- PostgREST'in şema önbelleğini tazele: yeni oluşturulan fonksiyon "anon" rolüne
-- tanınmayabilir. Bu ifade tanımsızsa (şema cache'i kilitliyse) hata vermez.
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;