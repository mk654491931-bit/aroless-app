-- Product Discovery hattı: kalıcı iş durumu + sahiplik.
--
-- GEREKÇE: `/api/product-discovery/start` işi bellekte (`Map`) tutuyordu.
-- Vercel/Netlify gibi sunucusuz çalışma zamanında her QStash adımı AYRI ve
-- SOĞUK bir fonksiyon örneğinde koşar; bellek o adımda boştur. Bu yüzden
-- sahiplik doğrulaması üretimde `NOT_FOUND` verip hattı 403 ile öldürüyordu.
-- Sahiplik artık `searches.user_id` üzerinden KALICI olarak doğrulanır.
--
-- `status` kolonu BİLEREK 'processing' | 'completed' | 'failed' üçlüsünde
-- kalır: mevcut istemci yoklaması, Realtime aboneliği ve `complete_search_job`
-- RPC'si bu değerleri tanır. Yeni 7'li durum makinesi ayrı bir kolonda
-- (`discovery_status`) tutulur; iki sütun birbirinin yerine geçmez, mevcut
-- akış bozulmaz.

ALTER TABLE public.searches
  ADD COLUMN IF NOT EXISTS discovery_status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS discovery_progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discovery_stats jsonb,
  ADD COLUMN IF NOT EXISTS discovery_step text NOT NULL DEFAULT 'scrape_filter',
  ADD COLUMN IF NOT EXISTS charged_credits integer NOT NULL DEFAULT 0;

-- 7'li durum makinesi veritabanı seviyesinde de korunur: uygulama katmanındaki
-- `PRODUCT_DISCOVERY_TRANSITIONS` ile aynı sözlüğü paylaşır.
DO $$
BEGIN
  ALTER TABLE public.searches
    DROP CONSTRAINT IF EXISTS searches_discovery_status_check;
  ALTER TABLE public.searches
    ADD CONSTRAINT searches_discovery_status_check
    CHECK (discovery_status IN (
      'queued', 'scraping', 'filtering', 'gemini_shortlist',
      'deep_analysis', 'completed', 'failed'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- İlerleme 0-100 aralığında olmalı; panel/SSE bu değeri doğrudan gösterir.
DO $$
BEGIN
  ALTER TABLE public.searches
    DROP CONSTRAINT IF EXISTS searches_discovery_progress_check;
  ALTER TABLE public.searches
    ADD CONSTRAINT searches_discovery_progress_check
    CHECK (discovery_progress >= 0 AND discovery_progress <= 100);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Yalnız hâlâ işleyen keşif işlerini hızlıca bulmak için kısmi indeks.
CREATE INDEX IF NOT EXISTS searches_discovery_active_idx
  ON public.searches (updated_at DESC)
  WHERE discovery_status NOT IN ('completed', 'failed');

-- Durum değişiklikleri için Realtime zaten `replica identity full` ile
-- yayınlanıyor (async_search_jobs.sql); bu migration ek bir şey gerekmiyor.

-- Atomik durum geçişi: yalnız BEKLENEN önceki durumdan ilerler.
--
-- Neden RPC: iki QStash adımı (biri retry'lanan) aynı anda çalışabilir. Adı
-- koşulsuz bir UPDATE koymak, geçmişte olmayan bir duruma geri dönüşe yol
-- açar (ör. `completed` → `filtering`). Burada `WHERE discovery_status = from`
-- koşulu ikinci yazıcıya etkisizleşir ve çağıran `false` görür.
CREATE OR REPLACE FUNCTION public.advance_discovery_status(
  _job_id uuid,
  _from text,
  _to text,
  _progress integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.searches
  SET
    discovery_status = _to,
    discovery_progress = COALESCE(_progress, discovery_progress),
    -- `status` yalnız terminal durumlarda ilerler; ara adımlarda 'processing'
    -- kalır ki mevcut istemci yoklaması işi "bitmiş" sanmasın.
    status = CASE
      WHEN _to = 'completed' THEN 'completed'
      WHEN _to = 'failed' THEN 'failed'
      ELSE status
    END,
    -- `error` bilerek dokunulmaz: hata metnini yalnızca `finish_discovery_job`
    -- yazar (tek seferlik, atomik). Ara adımlar hata metnini silmez.
    updated_at = now()
  WHERE id = _job_id
    AND discovery_status = _from
    AND status <> 'completed';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END;
$$;

-- Terminal sonucu TEK SEFER yazar. İkinci çağrıda (QStash retry) `false`
-- döner, böylece `result` üzerine yazılmaz ve istemciye iki farklı sonuç
-- görünmez.
CREATE OR REPLACE FUNCTION public.finish_discovery_job(
  _job_id uuid,
  _result jsonb,
  _failed boolean DEFAULT false,
  _error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.searches
  SET
    status = CASE WHEN _failed THEN 'failed' ELSE 'completed' END,
    discovery_status = CASE WHEN _failed THEN 'failed' ELSE 'completed' END,
    discovery_progress = CASE WHEN _failed THEN discovery_progress ELSE 100 END,
    result = CASE WHEN _failed THEN result ELSE _result END,
    error = CASE WHEN _failed THEN left(COALESCE(_error, 'Product discovery failed'), 2000) ELSE NULL END,
    locked_until = NULL,
    updated_at = now()
  WHERE id = _job_id
    AND status = 'processing';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END;
$$;

-- Kredinin bu iş için ALINIP ALINMADIĞINI sorar. İade kararı yalnızca bu
-- bayrağa bakar; böylece QStash iki kez "iş başarısız" derse kullanıcıya iki
-- kez iade olmaz.
CREATE OR REPLACE FUNCTION public.mark_discovery_credit_refunded(
  _job_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.searches
  SET credit_refunded = true, updated_at = now()
  WHERE id = _job_id
    AND credit_charged = true
    AND credit_refunded = false;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END;
$$;

-- Bu migration'ın fonksiyonları YALNIZCA servis rolü çağırabilir: gövdelerde
-- gelen `userId` kimliğine ASLA güvenilmez, sahiplik satırdan okunur.
REVOKE ALL ON FUNCTION public.advance_discovery_status(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_discovery_job(uuid, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_discovery_credit_refunded(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_discovery_status(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_discovery_job(uuid, jsonb, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_discovery_credit_refunded(uuid) TO service_role;
